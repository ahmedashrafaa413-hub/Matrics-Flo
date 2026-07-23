import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPerformanceSummary } from "../lib/performanceSummary.mjs";
import { getRiyadhDateRange } from "../lib/riyadhDateRange.mjs";
import { assertTrustedMutation } from "../lib/requestSecurity.mjs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Salla summaries and upserts are scoped by workspace", () => {
  const summary = read("app/api/salla/summary/route.js");
  const syncService = read("lib/sallaSyncService.js");

  assert.match(summary, /\.eq\("workspace_id", workspace\.id\)/);
  assert.doesNotMatch(summary, /\.eq\("user_id", user\.id\)/);
  assert.match(syncService, /onConflict: "workspace_id,order_id"/);
});

test("Salla synchronization cannot mutate data through GET", () => {
  const sync = read("app/api/salla/sync/route.js");

  assert.match(sync, /export async function POST\(request\)/);
  assert.match(sync, /status: 405/);
});

test("tokens are never accepted through internal API query parameters", () => {
  const intelligence = read("app/api/intelligence/analyze/route.js");
  const metaInsights = read("app/api/meta/insights/route.js");
  const snapInsights = read("app/api/snapchat/insights/route.js");

  assert.doesNotMatch(intelligence, /[?&](?:token|snap_token)=/);
  assert.doesNotMatch(metaInsights, /searchParams\.get\("token"\)/);
  assert.doesNotMatch(snapInsights, /searchParams\.get\("snap_token"\)/);
});

test("Snapchat synchronization uses POST and production debug routes are blocked", () => {
  const sync = read("app/api/snapchat/sync/route.js");
  const middleware = read("middleware.js");

  assert.match(sync, /export async function POST\(request\)/);
  assert.match(sync, /status: 405/);
  assert.match(middleware, /SNAPCHAT_DEBUG_PATHS/);
  assert.match(middleware, /process\.env\.NODE_ENV === "production"/);
});

test("workspace membership writes are denied to browser roles", () => {
  const migration = read(
    "supabase/migrations/202607220001_workspace_and_salla_isolation.sql"
  );

  assert.match(
    migration,
    /revoke insert, update, delete on public\.workspace_members from anon, authenticated/i
  );
  assert.doesNotMatch(
    migration,
    /create policy\s+"Users can insert own membership"/i
  );
});

test("actual ROAS uses Salla sales without double-counting platform attribution", () => {
  const summary = buildPerformanceSummary(
    [
      { source: "Meta Ads", type: "ads", spend: 100, sales: 500, purchases: 5 },
      { source: "Snapchat Ads", type: "ads", spend: 100, sales: 600, purchases: 6 }
    ],
    { actualSalesAvailable: true, actualSales: 800, actualPurchases: 8 }
  );

  assert.equal(summary.total_sales, 800);
  assert.equal(summary.total_ads_sales, 1100);
  assert.equal(summary.actual_roas, 4);
  assert.equal(summary.sales_source, "salla");
});

test("Salla date ranges use Riyadh midnight and an exclusive upper bound", () => {
  const range = getRiyadhDateRange("today", new Date("2026-07-22T21:30:00.000Z"));

  assert.equal(range.from, "2026-07-23");
  assert.equal(range.fromTimestamp, "2026-07-23T00:00:00+03:00");
  assert.equal(range.toExclusiveTimestamp, "2026-07-24T00:00:00+03:00");
});

test("cross-site mutation requests are rejected", () => {
  const request = {
    url: "https://metricsflo.com/api/snapchat/sync",
    headers: new Headers({
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site"
    })
  };

  assert.throws(() => assertTrustedMutation(request), /Cross-site/);
});

test("ad-account metadata rows do not duplicate provider tokens", () => {
  const metaCallback = read("app/api/meta/callback/route.js");
  const snapAccounts = read("app/api/snapchat/accounts/route.js");

  assert.match(metaCallback, /accountCurrency: account\.currency[\s\S]*accessToken: ""/);
  assert.match(snapAccounts, /accountCurrency: account\.currency[\s\S]*accessToken: ""/);
});
