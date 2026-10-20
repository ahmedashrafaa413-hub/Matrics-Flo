import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { summarizeTikTokRows } from "../lib/tiktokApi.mjs";

test("TikTok totals preserve spend, conversions and attributed revenue", () => {
  const summary = summarizeTikTokRows([
    { spend:100, impressions:1000, clicks:50, purchases:4, purchase_value:350 },
    { spend:20, impressions:300, clicks:10, purchases:1, purchase_value:50 }
  ], "SAR");
  assert.deepEqual(summary, {
    spend:120, impressions:1300, clicks:60, purchases:5, purchase_value:400,
    currency:"SAR", roas:400 / 120, cpa:24
  });
});

test("TikTok OAuth is tenant-admin protected and stores one encrypted master token", async () => {
  const auth = await readFile(new URL("../app/api/tiktok/auth/route.js", import.meta.url), "utf8");
  const callback = await readFile(new URL("../app/api/tiktok/callback/route.js", import.meta.url), "utf8");
  assert.match(auth, /requireWorkspaceRole\(workspace, "admin"\)/);
  assert.match(auth, /metricsflo_oauth|setOAuthStateCookie/);
  assert.match(callback, /accountId:"tiktok_default"/);
  assert.match(callback, /accessToken:""/);
  assert.match(callback, /verifyOAuthState/);
});

test("TikTok is included in connection status, performance and analytics", async () => {
  const files = await Promise.all([
    "../app/api/connections/status/route.js",
    "../app/api/performance/overview/route.js",
    "../app/api/analytics/overview/route.js",
    "../app/connections/page.jsx"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const source of files) assert.match(source, /tiktok/i);
});
