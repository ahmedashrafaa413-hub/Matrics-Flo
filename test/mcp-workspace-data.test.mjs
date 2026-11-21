import test from "node:test";
import assert from "node:assert/strict";
import {
  isTokenRow,
  listAdAccountsFromRows,
  mapWithConcurrency,
  summarizeIntegrations,
  withTimeout
} from "../lib/mcpConnections.mjs";
import { enrichMetaRow, fetchMetaInsights, summarizeMetaRows } from "../lib/metaInsights.mjs";
import { findLatestSnapchatMetricDate, normalizeSnapchatLevel, readSnapchatCache } from "../lib/snapchatCache.mjs";
import { parseGa4OverviewRow } from "../lib/ga4Overview.mjs";

const rows = [
  { workspace_id: "w1", provider: "meta", account_id: "meta_default", is_active: true, has_access_token: true, updated_at: "2026-10-20" },
  { workspace_id: "w1", provider: "meta", account_id: "act_2", account_name: "Zeta", account_currency: "SAR", is_active: true, updated_at: "2026-10-19" },
  { workspace_id: "w1", provider: "meta", account_id: "act_1", account_name: "Alpha", account_currency: "EGP", is_active: true, updated_at: "2026-10-18" },
  { workspace_id: "w1", provider: "snapchat", account_id: "snapchat_default", is_active: true, has_refresh_token: true, updated_at: "2026-11-21" },
  { workspace_id: "w1", provider: "snapchat", account_id: "uuid-1", account_name: "Snap A", account_currency: "USD", is_active: true, updated_at: "2026-11-21" },
  { workspace_id: "w1", provider: "ga4", account_id: "ga4_default", is_active: true, has_refresh_token: true, updated_at: "2026-11-21" }
];

test("token rows are not treated as ad accounts", () => {
  assert.equal(isTokenRow(rows[0]), true);
  assert.equal(isTokenRow(rows[1]), false);
  const meta = listAdAccountsFromRows(rows, "meta");
  assert.equal(meta.connected, true);
  assert.deepEqual(meta.accounts.map((a) => a.id), ["act_1", "act_2"]);
  assert.equal(meta.accounts[0].currency, "EGP");
});

test("a provider without a token row is reported as not connected", () => {
  const snap = listAdAccountsFromRows(rows.filter((r) => r.account_id !== "snapchat_default"), "snapchat");
  assert.equal(snap.connected, false);
  assert.equal(snap.accounts.length, 1);
});

test("integration summary counts ad accounts per platform", () => {
  const summary = summarizeIntegrations(rows);
  assert.deepEqual(
    summary.map(({ platform, connected, ad_accounts }) => ({ platform, connected, ad_accounts })),
    [
      { platform: "ga4", connected: true, ad_accounts: 0 },
      { platform: "meta", connected: true, ad_accounts: 2 },
      { platform: "snapchat", connected: true, ad_accounts: 1 }
    ]
  );
});

test("mapWithConcurrency keeps order and limits parallelism", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
  assert.equal(peak, 2);
});

test("withTimeout rejects slow work", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10, "meta"), /meta timed out/);
});

test("Meta rows are enriched with purchases, revenue and ROAS", () => {
  const row = enrichMetaRow({
    spend: "100",
    impressions: "1000",
    actions: [{ action_type: "purchase", value: "4" }, { action_type: "add_to_cart", value: "10" }],
    action_values: [{ action_type: "purchase", value: "500" }]
  });
  assert.equal(row.purchases, 4);
  assert.equal(row.purchase_value, 500);
  assert.equal(row.roas, 5);
  assert.equal(row.cpa, 25);
  const summary = summarizeMetaRows([row, row]);
  assert.equal(summary.spend, 200);
  assert.equal(summary.roas, 5);
  assert.equal(summary.cart_abandonment_rate, 60);
});

test("fetchMetaInsights calls the account insights edge and reads its currency", async () => {
  let calledUrl = "";
  const fetchImpl = async (url) => {
    calledUrl = url;
    return new Response(JSON.stringify({ data: [{ spend: "10", account_currency: "SAR" }] }), { status: 200 });
  };
  const result = await fetchMetaInsights({ token: "t", accountId: "act_1", level: "account", datePreset: "last_7d", fetchImpl });
  const url = new URL(calledUrl);
  assert.equal(url.pathname.endsWith("/act_1/insights"), true);
  assert.equal(url.searchParams.get("level"), "account");
  assert.equal(url.searchParams.get("date_preset"), "last_7d");
  assert.equal(result.currency, "SAR");
  assert.equal(result.summary.spend, 10);
});

// Minimal stand-in for the Supabase query builder used by snapchatCache.
function fakeAdmin(table) {
  return {
    from() {
      const filters = [];
      let order = null;
      let limit = Infinity;
      let range = null;
      const run = () => {
        let out = table.filter((row) => filters.every((f) => f(row)));
        if (order) out = [...out].sort((a, b) => (order.asc ? 1 : -1) * (a[order.col] > b[order.col] ? 1 : a[order.col] < b[order.col] ? -1 : 0));
        const count = out.length;
        if (range) out = out.slice(range[0], range[1] + 1);
        out = out.slice(0, limit);
        return { data: out, count, error: null };
      };
      const q = {
        select() { return q; },
        eq(col, val) { filters.push((r) => r[col] === val); return q; },
        filter(col, _op, val) { filters.push((r) => r.raw?.date_preset === val); return q; },
        order(col, opts) { order = { col, asc: opts?.ascending !== false }; return q; },
        limit(n) { limit = n; return q; },
        range(a, b) { range = [a, b]; return q; },
        maybeSingle() { const r = run(); return Promise.resolve({ data: r.data[0] || null, error: null }); },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); }
      };
      return q;
    }
  };
}

const snapRows = [
  { workspace_id: "w1", provider: "snapchat", account_id: "a1", metric_date: "2026-11-19", entity_level: "account", spend: 50, revenue: 100, purchases: 2, impressions: 10, clicks: 1, currency: "USD", raw: { date_preset: "last_7d" } },
  { workspace_id: "w1", provider: "snapchat", account_id: "a1", metric_date: "2026-11-21", entity_level: "account", spend: 80, revenue: 240, purchases: 3, impressions: 20, clicks: 2, currency: "USD", raw: { date_preset: "last_7d" } },
  { workspace_id: "w1", provider: "snapchat", account_id: "a1", metric_date: "2026-11-21", entity_level: "campaign", entity_id: "c1", entity_name: "C1", spend: 80, revenue: 240, raw: { date_preset: "last_7d" } },
  { workspace_id: "w2", provider: "snapchat", account_id: "a1", metric_date: "2026-11-22", entity_level: "account", spend: 999, raw: { date_preset: "last_7d" } }
];

test("Snapchat cache uses the latest synced date inside the workspace only", async () => {
  const admin = fakeAdmin(snapRows);
  const date = await findLatestSnapchatMetricDate(admin, { workspaceId: "w1", accountId: "a1", datePreset: "last_7d", level: "account" });
  assert.equal(date, "2026-11-21");
  const cache = await readSnapchatCache(admin, { workspaceId: "w1", accountId: "a1", datePreset: "last_7d", level: "campaign", metricDate: date });
  assert.equal(cache.summary.spend, 80);
  assert.equal(cache.summary.roas, 3);
  assert.equal(cache.rows.length, 1);
  assert.equal(cache.rows[0].name, "C1");
});

test("Snapchat cache refuses to run without a workspace", async () => {
  await assert.rejects(readSnapchatCache(fakeAdmin([]), { accountId: "a1" }), /workspaceId is required/);
  assert.equal(normalizeSnapchatLevel("ad_squads"), "adsquad");
});

test("GA4 overview rows are parsed into percentages", () => {
  const metrics = parseGa4OverviewRow({ rows: [{ metricValues: [{ value: "200" }, { value: "150" }, { value: "400" }, { value: "10" }, { value: "0.5" }, { value: "0.4" }, { value: "61.234" }] }] });
  assert.equal(metrics.sessions, 200);
  assert.equal(metrics.conversionRate, 5);
  assert.equal(metrics.engagementRate, 50);
  assert.equal(metrics.averageSessionDuration, 61.23);
});
