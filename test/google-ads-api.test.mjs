import test from "node:test";
import assert from "node:assert/strict";
import {
  accountsFromCustomerClients,
  buildGoogleAdsQuery,
  discoverGoogleAdsAccounts,
  fetchGoogleAdsInsights,
  googleAdsApiBase,
  googleAdsDateBounds,
  googleAdsErrorMessage,
  googleAdsHeaders,
  normalizeCustomerId,
  summarizeGoogleAdsRows
} from "../lib/googleAdsApi.mjs";

const env = { GOOGLE_ADS_API_VERSION: "v26" };

test("normalizeCustomerId accepts dashed, prefixed and bare IDs", () => {
  assert.equal(normalizeCustomerId("123-456-7890"), "1234567890");
  assert.equal(normalizeCustomerId("customers/1234567890"), "1234567890");
  assert.equal(normalizeCustomerId("act_123"), "");
  assert.equal(normalizeCustomerId("1 OR 1=1"), "");
});

test("googleAdsApiBase rejects odd versions", () => {
  assert.equal(googleAdsApiBase(env), "https://googleads.googleapis.com/v26");
  assert.throws(() => googleAdsApiBase({ GOOGLE_ADS_API_VERSION: "v26/../x" }));
});

test("headers carry developer token and optional login-customer-id", () => {
  const h = googleAdsHeaders({ accessToken: "a", developerToken: "d", loginCustomerId: "111-222-3333" });
  assert.equal(h["developer-token"], "d");
  assert.equal(h["login-customer-id"], "1112223333");
  assert.equal(googleAdsHeaders({ accessToken: "a", developerToken: "d" })["login-customer-id"], undefined);
  assert.throws(() => googleAdsHeaders({ accessToken: "a", developerToken: "" }), /DEVELOPER_TOKEN/);
});

test("buildGoogleAdsQuery filters by date and scope and validates IDs", () => {
  const q = buildGoogleAdsQuery({ level: "ad", since: "2026-11-01", until: "2026-11-22", campaignId: "42", daily: true });
  assert.match(q, /FROM ad_group_ad/);
  assert.match(q, /segments\.date BETWEEN '2026-11-01' AND '2026-11-22'/);
  assert.match(q, /campaign\.id = 42/);
  assert.match(q, /segments\.date(,| FROM)/);
  assert.throws(() => buildGoogleAdsQuery({ level: "ad", since: "2026-11-01", until: "2026-11-22", campaignId: "1 OR 1=1" }));
  assert.throws(() => buildGoogleAdsQuery({ level: "campaign", since: "x", until: "2026-11-22" }));
  assert.throws(() => buildGoogleAdsQuery({ level: "adset", since: "2026-11-01", until: "2026-11-22" }));
  assert.match(buildGoogleAdsQuery({ level: "search_term", since: "2026-11-01", until: "2026-11-22" }), /ORDER BY metrics\.cost_micros DESC LIMIT 1000$/);
  assert.doesNotMatch(buildGoogleAdsQuery({ level: "account", since: "2026-11-01", until: "2026-11-22" }), /impressions > 0/);
});

test("googleAdsDateBounds uses Riyadh days and custom ranges", () => {
  const now = new Date("2026-11-22T22:30:00Z"); // 01:30 on Nov 23 in Riyadh
  assert.deepEqual(googleAdsDateBounds({ datePreset: "today", now }), { since: "2026-11-23", until: "2026-11-23" });
  assert.deepEqual(googleAdsDateBounds({ datePreset: "yesterday", now }), { since: "2026-11-22", until: "2026-11-22" });
  assert.deepEqual(googleAdsDateBounds({ range: { since: "2026-11-01", until: "2026-11-05" }, now }), { since: "2026-11-01", until: "2026-11-05" });
});

const campaignRow = (id, date, cost, conv, value, extra = {}) => ({
  campaign: { id, name: `C${id}`, status: "ENABLED", advertisingChannelType: "SEARCH", biddingStrategyType: "MAXIMIZE_CONVERSIONS" },
  campaignBudget: { amountMicros: "75000000" },
  metrics: { costMicros: String(cost * 1e6), impressions: "1000", clicks: "50", conversions: conv, conversionsValue: value, searchImpressionShare: 0.42, ...extra },
  segments: { date }
});

test("summarizeGoogleAdsRows sums per entity, converts micros and computes ratios", () => {
  const { summary, rows } = summarizeGoogleAdsRows("campaign", [
    campaignRow("1", "2026-11-20", 100, 2, 600),
    campaignRow("1", "2026-11-21", 50, 1, 300),
    campaignRow("2", "2026-11-21", 200, 0, 0)
  ], { daily: true });
  assert.equal(rows[0].id, "2");
  const c1 = rows.find((r) => r.id === "1");
  assert.equal(c1.spend, 150);
  assert.equal(c1.conversions, 3);
  assert.equal(c1.roas, 6);
  assert.equal(c1.cpa, 50);
  assert.equal(c1.daily_budget, 75);
  assert.equal(c1.status, "enabled");
  assert.deepEqual(c1.daily.map((d) => d.date), ["2026-11-20", "2026-11-21"]);
  assert.equal(summary.spend, 350);
  assert.equal(summary.ctr, 5);
});

test("campaign impression share is reported without daily", () => {
  const { rows } = summarizeGoogleAdsRows("campaign", [campaignRow("1", undefined, 10, 1, 50)]);
  assert.equal(rows[0].search_impression_share, 42);
  assert.equal(rows[0].daily, undefined);
});

test("accountsFromCustomerClients drops managers and records the manager path", () => {
  const accounts = accountsFromCustomerClients("9990001111", [
    { customerClient: { id: "9990001111", descriptiveName: "MCC", manager: true } },
    { customerClient: { id: "1234567890", descriptiveName: "LORD", currencyCode: "SAR", timeZone: "Asia/Riyadh", manager: false, status: "ENABLED" } }
  ]);
  assert.deepEqual(accounts, [{ id: "1234567890", name: "LORD", currency: "SAR", time_zone: "Asia/Riyadh", status: "enabled", platform: "google_ads", login_customer_id: "9990001111" }]);
});

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const handler = routes.find(([pattern]) => url.includes(pattern));
    const [status, body] = handler ? handler[1](url, init) : [404, { error: { message: "nope" } }];
    return { ok: status < 300, status, text: async () => JSON.stringify(body) };
  };
  impl.calls = calls;
  return impl;
}

test("discoverGoogleAdsAccounts prefers direct access over a manager path", async () => {
  const fetchImpl = fakeFetch([
    ["listAccessibleCustomers", () => [200, { resourceNames: ["customers/1234567890", "customers/9990001111"] }]],
    ["customers/1234567890/googleAds", () => [200, [{ results: [{ customerClient: { id: "1234567890", descriptiveName: "LORD", manager: false } }] }]]],
    ["customers/9990001111/googleAds", () => [200, [{ results: [
      { customerClient: { id: "9990001111", manager: true } },
      { customerClient: { id: "1234567890", descriptiveName: "LORD", manager: false } },
      { customerClient: { id: "5555555555", descriptiveName: "Other", manager: false } }
    ] }]]]
  ]);
  const { accounts, errors } = await discoverGoogleAdsAccounts({ accessToken: "a", developerToken: "d", fetchImpl, env });
  assert.deepEqual(errors, []);
  assert.equal(accounts.find((a) => a.id === "1234567890").login_customer_id, "");
  assert.equal(accounts.find((a) => a.id === "5555555555").login_customer_id, "9990001111");
});

test("fetchGoogleAdsInsights surfaces Google Ads error details", async () => {
  const fetchImpl = fakeFetch([
    ["googleAds:searchStream", () => [403, [{ error: { message: "The caller does not have permission", details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" }, message: "The developer token is only approved for use with test accounts." }] }] } }]]]
  ]);
  await assert.rejects(
    fetchGoogleAdsInsights({ customerId: "1234567890", accessToken: "a", developerToken: "d", fetchImpl, env }),
    /test accounts\. \(DEVELOPER_TOKEN_NOT_APPROVED\)/
  );
  assert.equal(googleAdsErrorMessage({}, 500), "Google Ads request failed (HTTP 500)");
});

test("fetchGoogleAdsInsights sends the query to the right customer with login-customer-id", async () => {
  const fetchImpl = fakeFetch([
    ["customers/1234567890/googleAds:searchStream", () => [200, [{ results: [campaignRow("7", undefined, 30, 1, 120)] }]]]
  ]);
  const out = await fetchGoogleAdsInsights({ customerId: "123-456-7890", loginCustomerId: "9990001111", accessToken: "a", developerToken: "d", range: { since: "2026-11-01", until: "2026-11-22" }, fetchImpl, env });
  assert.equal(fetchImpl.calls[0].init.headers["login-customer-id"], "9990001111");
  assert.match(JSON.parse(fetchImpl.calls[0].init.body).query, /BETWEEN '2026-11-01' AND '2026-11-22'/);
  assert.equal(out.summary.roas, 4);
  assert.equal(out.rows[0].id, "7");
});
