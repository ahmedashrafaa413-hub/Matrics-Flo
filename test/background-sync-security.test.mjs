import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret
} from "../lib/tokenEncryption.mjs";

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("provider credentials use authenticated AES-256-GCM encryption", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptSecret("provider-secret", { key });

  assert.equal(isEncryptedSecret(encrypted), true);
  assert.notEqual(encrypted, "provider-secret");
  assert.equal(decryptSecret(encrypted, { key }), "provider-secret");
  assert.throws(
    () =>
      decryptSecret(encrypted, {
        key: Buffer.alloc(32, 8).toString("base64")
      }),
    /Unable to decrypt/
  );
});

test("new provider credentials cannot be stored without encryption", () => {
  assert.throws(
    () => encryptSecret("provider-secret", { key: "" }),
    /TOKEN_ENCRYPTION_KEY is required/
  );
});

test("plaintext credentials remain readable during the rollout", () => {
  assert.equal(decryptSecret("legacy-plaintext-token"), "legacy-plaintext-token");
});

test("Snapchat diagnostic routes are unavailable in production", () => {
  const diagnosticRoutes = [
    "app/api/snapchat/debug/route.js",
    "app/api/snapchat/raw-test/route.js",
    "app/api/snapchat/test-fields/route.js",
    "app/api/snapchat/debug-stats/route.js",
    "app/api/snapchat/debug-breakdown/route.js",
    "app/api/snapchat/debug-compare/route.js"
  ];

  for (const path of diagnosticRoutes) {
    const route = read(path);
    assert.match(route, /process\.env\.NODE_ENV === "production"/);
    assert.match(route, /status: 404/);
  }
});

test("sync mutations return quickly through durable background jobs", () => {
  const snapchatRoute = read("app/api/snapchat/sync/route.js");
  const sallaRoute = read("app/api/salla/sync/route.js");
  const workflow = read("workflows/provider-sync.js");
  const snapchatPage = read("app/snapchat/page.jsx");

  assert.match(snapchatRoute, /startProviderSync/);
  assert.match(sallaRoute, /startProviderSync/);
  assert.match(snapchatRoute, /status: started\.reused \? 200 : 202/);
  assert.match(workflow, /"use workflow"/);
  assert.match(workflow, /"use step"/);
  assert.match(snapchatPage, /\/api\/sync-jobs\//);
});

test("Snapchat overview includes non-archived campaigns for attribution accuracy", () => {
  const syncService = read("lib/snapchatSyncService.js");
  const snapchatApi = read("lib/snapchatApi.js");
  const accountBranch =
    syncService.match(
      /if \(level === "account"\) \{([\s\S]*?)\n      \} else \{/
    )?.[1] || "";
  const accountHelper =
    snapchatApi.match(
      /export async function fetchAccountStats\(args\) \{([\s\S]*?)\n\}/
    )?.[1] || "";

  assert.match(accountBranch, /fetchAccountStats/);
  assert.doesNotMatch(accountBranch, /getCampaignStats/);
  assert.match(accountHelper, /fetchEntities/);
  assert.match(accountHelper, /DELETED/);\n  assert.match(accountHelper, /ARCHIVED/);\n  assert.doesNotMatch(accountHelper, /entity\\.status === "ACTIVE"/);
  assert.match(accountHelper, /fetchEntityStats/);
  assert.match(accountHelper, /results\.reduce/);
  assert.match(accountHelper, /failed\.length/);
  assert.doesNotMatch(accountHelper, /fetchBreakdownStats/);
});

test("Snapchat date ranges end on an exact hour boundary", () => {
  const snapchatApi = read("lib/snapchatApi.js");

  assert.match(snapchatApi, /T\$\{pad\(h\)\}:00:00\.000\+03:00/);
  assert.doesNotMatch(snapchatApi, /getUTCMinutes|nowMin|endMinute/);
});

test("rate limit and job tables are server-only and tenant-scoped", () => {
  const migration = read(
    "supabase/migrations/202607230001_sync_jobs_and_rate_limits.sql"
  );

  assert.match(
    migration,
    /alter table public\.provider_sync_jobs enable row level security/i
  );
  assert.match(
    migration,
    /revoke all on table public\.provider_sync_jobs from anon, authenticated/i
  );
  assert.match(
    migration,
    /create unique index if not exists provider_sync_jobs_one_active_request/i
  );
  assert.match(
    migration,
    /grant execute on function public\.consume_api_rate_limit[\s\S]*to service_role/i
  );
});
