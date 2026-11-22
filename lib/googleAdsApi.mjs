// Google Ads API (REST) client: account discovery and live performance
// reports by account, campaign, ad group, asset group (Performance Max),
// ad, keyword and search term. Pure helpers plus fetch-injected calls, so it
// can be unit tested without Next or Supabase.
//
// Every call needs an OAuth access token with the `adwords` scope and a
// developer token from a Google Ads manager account (API Center). Accounts
// reached through a manager account also need its ID as login-customer-id.

import { getRiyadhDateRange } from "./riyadhDateRange.mjs";

export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
export const DEFAULT_GOOGLE_ADS_API_VERSION = "v26";
export const GOOGLE_ADS_LEVELS = ["account", "campaign", "ad_group", "asset_group", "ad", "keyword", "search_term"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function googleAdsApiBase(env = process.env) {
  const version = String(env.GOOGLE_ADS_API_VERSION || DEFAULT_GOOGLE_ADS_API_VERSION).trim();
  if (!/^v\d{2,3}$/.test(version)) throw new Error("GOOGLE_ADS_API_VERSION must look like v26");
  return `https://googleads.googleapis.com/${version}`;
}

// "123-456-7890" or "customers/1234567890" -> "1234567890"
export function normalizeCustomerId(value) {
  const digits = String(value || "").replace(/^customers\//, "").replace(/-/g, "").trim();
  return /^\d{6,12}$/.test(digits) ? digits : "";
}

export function formatCustomerId(id) {
  const digits = normalizeCustomerId(id);
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

export function googleAdsHeaders({ accessToken, developerToken, loginCustomerId = "" }) {
  if (!accessToken) throw new Error("Missing Google Ads access token");
  if (!developerToken) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is not configured");
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json"
  };
  const login = normalizeCustomerId(loginCustomerId);
  if (login) headers["login-customer-id"] = login;
  return headers;
}

// Google Ads errors come as { error: { message, details: [{ errors: [{ message }] }] } },
// or as an array of those for searchStream.
export function googleAdsErrorMessage(data, status) {
  const body = Array.isArray(data) ? data.find((item) => item?.error) : data;
  const error = body?.error;
  const detail = error?.details?.find((d) => Array.isArray(d?.errors))?.errors?.[0];
  const code = detail?.errorCode ? Object.values(detail.errorCode)[0] : "";
  const message = detail?.message || error?.message || `Google Ads request failed (HTTP ${status})`;
  return code ? `${message} (${code})` : message;
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { error: { message: text.slice(0, 300) } }; }
}

export async function googleAdsSearch({ customerId, query, accessToken, developerToken, loginCustomerId = "", fetchImpl = fetch, env = process.env }) {
  const id = normalizeCustomerId(customerId);
  if (!id) throw new Error("Invalid Google Ads customer ID");
  const response = await fetchImpl(`${googleAdsApiBase(env)}/customers/${id}/googleAds:searchStream`, {
    method: "POST",
    cache: "no-store",
    headers: googleAdsHeaders({ accessToken, developerToken, loginCustomerId }),
    body: JSON.stringify({ query })
  });
  const data = await readJson(response);
  if (!response.ok || (Array.isArray(data) && data.some((item) => item?.error)) || (!Array.isArray(data) && data?.error)) {
    const error = new Error(googleAdsErrorMessage(data, response.status));
    error.status = response.status;
    throw error;
  }
  return (Array.isArray(data) ? data : [data]).flatMap((batch) => batch?.results || []);
}

export async function listAccessibleCustomers({ accessToken, developerToken, fetchImpl = fetch, env = process.env }) {
  const response = await fetchImpl(`${googleAdsApiBase(env)}/customers:listAccessibleCustomers`, {
    method: "GET",
    cache: "no-store",
    headers: googleAdsHeaders({ accessToken, developerToken })
  });
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(googleAdsErrorMessage(data, response.status));
    error.status = response.status;
    throw error;
  }
  return (data.resourceNames || []).map(normalizeCustomerId).filter(Boolean);
}

const CUSTOMER_CLIENT_QUERY = `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.level <= 1`;

// rootId: the accessible customer the rows were read through.
export function accountsFromCustomerClients(rootId, rows) {
  const root = normalizeCustomerId(rootId);
  return (rows || [])
    .map((row) => row.customerClient || {})
    .filter((client) => client.id && client.manager !== true)
    .map((client) => {
      const id = normalizeCustomerId(client.id);
      return {
        id,
        name: client.descriptiveName || formatCustomerId(id),
        currency: client.currencyCode || null,
        time_zone: client.timeZone || null,
        status: client.status ? String(client.status).toLowerCase() : null,
        platform: "google_ads",
        // Reached through a manager account: calls need that manager as login-customer-id.
        login_customer_id: id === root ? "" : root
      };
    });
}

// Every non-manager account the Google user can read, directly or through a
// manager account one level up. Accounts reachable both ways keep the direct path.
export async function discoverGoogleAdsAccounts({ accessToken, developerToken, loginCustomerId = "", fetchImpl = fetch, env = process.env }) {
  const configuredManager = normalizeCustomerId(loginCustomerId);
  const roots = configuredManager
    ? [configuredManager]
    : await listAccessibleCustomers({ accessToken, developerToken, fetchImpl, env });

  const byId = new Map();
  const errors = [];
  for (const rootId of roots.slice(0, 25)) {
    try {
      const rows = await googleAdsSearch({ customerId: rootId, query: CUSTOMER_CLIENT_QUERY, accessToken, developerToken, loginCustomerId: rootId, fetchImpl, env });
      for (const account of accountsFromCustomerClients(rootId, rows)) {
        const existing = byId.get(account.id);
        if (!existing || (existing.login_customer_id && !account.login_customer_id)) byId.set(account.id, account);
      }
    } catch (error) {
      errors.push({ customer_id: rootId, error: error.message });
    }
  }
  const accounts = [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { accounts, errors };
}

// Inclusive YYYY-MM-DD bounds in Asia/Riyadh (the account's own timezone is
// used by Google for segments.date; LORD's accounts run on Riyadh time).
export function googleAdsDateBounds({ datePreset = "last_30d", range = null, now = new Date() } = {}) {
  if (range?.since && range?.until) return { since: range.since, until: range.until };
  const { from, to } = getRiyadhDateRange(datePreset, now);
  return { since: from, until: to };
}

const METRIC_FIELDS = [
  "metrics.cost_micros",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.conversions",
  "metrics.conversions_value",
  "metrics.all_conversions",
  "metrics.all_conversions_value"
];

const LEVELS = {
  account: {
    from: "customer",
    fields: ["customer.id", "customer.descriptive_name", "customer.currency_code"]
  },
  campaign: {
    from: "campaign",
    fields: [
      "campaign.id", "campaign.name", "campaign.status", "campaign.advertising_channel_type",
      "campaign.bidding_strategy_type", "campaign_budget.amount_micros"
    ],
    extraMetrics: ["metrics.search_impression_share", "metrics.search_budget_lost_impression_share", "metrics.search_rank_lost_impression_share"]
  },
  ad_group: {
    from: "ad_group",
    fields: ["ad_group.id", "ad_group.name", "ad_group.status", "ad_group.type", "campaign.id", "campaign.name"]
  },
  asset_group: {
    from: "asset_group",
    fields: ["asset_group.id", "asset_group.name", "asset_group.status", "campaign.id", "campaign.name"]
  },
  ad: {
    from: "ad_group_ad",
    fields: [
      "ad_group_ad.ad.id", "ad_group_ad.ad.name", "ad_group_ad.ad.type", "ad_group_ad.status",
      "ad_group_ad.ad.final_urls", "ad_group.id", "ad_group.name", "campaign.id", "campaign.name"
    ]
  },
  keyword: {
    from: "keyword_view",
    fields: [
      "ad_group_criterion.criterion_id", "ad_group_criterion.keyword.text", "ad_group_criterion.keyword.match_type",
      "ad_group_criterion.status", "ad_group_criterion.quality_info.quality_score",
      "ad_group.id", "ad_group.name", "campaign.id", "campaign.name"
    ]
  },
  search_term: {
    from: "search_term_view",
    fields: ["search_term_view.search_term", "search_term_view.status", "ad_group.id", "ad_group.name", "campaign.id", "campaign.name"],
    orderBy: "metrics.cost_micros DESC",
    limit: 1000
  }
};

export function buildGoogleAdsQuery({ level = "campaign", since, until, daily = false, campaignId = "", adGroupId = "" }) {
  const spec = LEVELS[level];
  if (!spec) throw new Error(`Unsupported Google Ads level: ${level}`);
  if (!DATE_RE.test(since || "") || !DATE_RE.test(until || "")) throw new Error("since and until must be YYYY-MM-DD");
  const select = [...spec.fields, ...METRIC_FIELDS, ...(spec.extraMetrics || []), ...(daily ? ["segments.date"] : [])];
  const where = [`segments.date BETWEEN '${since}' AND '${until}'`];
  if (level !== "account") where.push("metrics.impressions > 0");
  if (campaignId) {
    if (!/^\d{1,20}$/.test(campaignId)) throw new Error("Invalid campaign_id");
    where.push(`campaign.id = ${campaignId}`);
  }
  if (adGroupId) {
    if (!/^\d{1,20}$/.test(adGroupId)) throw new Error("Invalid ad_group_id");
    where.push(`ad_group.id = ${adGroupId}`);
  }
  let query = `SELECT ${select.join(", ")} FROM ${spec.from} WHERE ${where.join(" AND ")}`;
  if (spec.orderBy && !daily) query += ` ORDER BY ${spec.orderBy}`;
  if (spec.limit && !daily) query += ` LIMIT ${spec.limit}`;
  return query;
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));
const microsToMoney = (value) => num(value) / 1e6;
const lower = (value) => (value ? String(value).toLowerCase() : null);

function entityFromRow(level, row) {
  const campaign = row.campaign || {};
  const adGroup = row.adGroup || {};
  const base = (extra) => ({ ...extra });
  switch (level) {
    case "account":
      return base({ id: String(row.customer?.id || ""), name: row.customer?.descriptiveName || "" });
    case "campaign":
      return base({
        id: String(campaign.id || ""),
        name: campaign.name || "",
        status: lower(campaign.status),
        channel: lower(campaign.advertisingChannelType),
        bidding_strategy: lower(campaign.biddingStrategyType),
        daily_budget: row.campaignBudget?.amountMicros !== undefined ? round(microsToMoney(row.campaignBudget.amountMicros)) : null
      });
    case "ad_group":
      return base({ id: String(adGroup.id || ""), name: adGroup.name || "", status: lower(adGroup.status), type: lower(adGroup.type), campaign_id: String(campaign.id || ""), campaign_name: campaign.name || "" });
    case "asset_group": {
      const group = row.assetGroup || {};
      return base({ id: String(group.id || ""), name: group.name || "", status: lower(group.status), campaign_id: String(campaign.id || ""), campaign_name: campaign.name || "" });
    }
    case "ad": {
      const ad = row.adGroupAd?.ad || {};
      return base({
        id: String(ad.id || ""),
        name: ad.name || `${lower(ad.type) || "ad"} ${ad.id || ""}`.trim(),
        status: lower(row.adGroupAd?.status),
        type: lower(ad.type),
        final_url: ad.finalUrls?.[0] || null,
        ad_group_id: String(adGroup.id || ""),
        ad_group_name: adGroup.name || "",
        campaign_id: String(campaign.id || ""),
        campaign_name: campaign.name || ""
      });
    }
    case "keyword": {
      const criterion = row.adGroupCriterion || {};
      return base({
        id: `${adGroup.id || ""}~${criterion.criterionId || ""}`,
        name: criterion.keyword?.text || "",
        match_type: lower(criterion.keyword?.matchType),
        status: lower(criterion.status),
        quality_score: criterion.qualityInfo?.qualityScore ?? null,
        ad_group_id: String(adGroup.id || ""),
        ad_group_name: adGroup.name || "",
        campaign_id: String(campaign.id || ""),
        campaign_name: campaign.name || ""
      });
    }
    case "search_term": {
      const term = row.searchTermView || {};
      return base({
        id: `${adGroup.id || ""}~${term.searchTerm || ""}`,
        name: term.searchTerm || "",
        status: lower(term.status),
        ad_group_id: String(adGroup.id || ""),
        ad_group_name: adGroup.name || "",
        campaign_id: String(campaign.id || ""),
        campaign_name: campaign.name || ""
      });
    }
    default:
      return base({ id: "", name: "" });
  }
}

function emptyTotals() {
  return { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, all_conversions: 0, all_conversion_value: 0 };
}

function addMetrics(totals, metrics = {}) {
  totals.spend += microsToMoney(metrics.costMicros);
  totals.impressions += num(metrics.impressions);
  totals.clicks += num(metrics.clicks);
  totals.conversions += num(metrics.conversions);
  totals.conversion_value += num(metrics.conversionsValue);
  totals.all_conversions += num(metrics.allConversions);
  totals.all_conversion_value += num(metrics.allConversionsValue);
  return totals;
}

export function finalizeMetrics(t) {
  return {
    spend: round(t.spend),
    impressions: Math.round(t.impressions),
    clicks: Math.round(t.clicks),
    ctr: t.impressions > 0 ? round((t.clicks / t.impressions) * 100) : 0,
    cpc: t.clicks > 0 ? round(t.spend / t.clicks) : 0,
    cpm: t.impressions > 0 ? round((t.spend / t.impressions) * 1000) : 0,
    conversions: round(t.conversions),
    conversion_value: round(t.conversion_value),
    roas: t.spend > 0 ? round(t.conversion_value / t.spend) : 0,
    cpa: t.conversions > 0 ? round(t.spend / t.conversions) : 0,
    conversion_rate: t.clicks > 0 ? round((t.conversions / t.clicks) * 100) : 0,
    all_conversions: round(t.all_conversions),
    all_conversion_value: round(t.all_conversion_value)
  };
}

function impressionShare(metrics = {}) {
  const pct = (value) => (value === undefined || value === null ? null : round(num(value) * 100));
  return {
    search_impression_share: pct(metrics.searchImpressionShare),
    search_lost_is_budget: pct(metrics.searchBudgetLostImpressionShare),
    search_lost_is_rank: pct(metrics.searchRankLostImpressionShare)
  };
}

// Sums rows per entity (rows repeat per day when segments.date is selected),
// sorted by spend. With daily, each row carries its day-by-day series.
export function summarizeGoogleAdsRows(level, results, { daily = false } = {}) {
  const byId = new Map();
  const summary = emptyTotals();

  for (const row of results || []) {
    const entity = entityFromRow(level, row);
    const key = entity.id || entity.name;
    let entry = byId.get(key);
    if (!entry) {
      entry = { entity, totals: emptyTotals(), days: new Map(), share: null };
      byId.set(key, entry);
    }
    addMetrics(entry.totals, row.metrics);
    addMetrics(summary, row.metrics);
    if (level === "campaign" && !daily) entry.share = impressionShare(row.metrics);
    if (daily && row.segments?.date) {
      const day = entry.days.get(row.segments.date) || emptyTotals();
      entry.days.set(row.segments.date, addMetrics(day, row.metrics));
    }
  }

  const rows = [...byId.values()]
    .map(({ entity, totals, days, share }) => ({
      ...entity,
      ...finalizeMetrics(totals),
      ...(share && share.search_impression_share !== null ? share : {}),
      ...(daily
        ? {
            daily: [...days.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([date, t]) => {
                const m = finalizeMetrics(t);
                return { date, spend: m.spend, conversions: m.conversions, conversion_value: m.conversion_value, roas: m.roas, cpa: m.cpa, clicks: m.clicks, impressions: m.impressions, ctr: m.ctr, cpc: m.cpc };
              })
          }
        : {})
    }))
    .sort((a, b) => b.spend - a.spend);

  return { summary: finalizeMetrics(summary), rows };
}

export async function fetchGoogleAdsInsights({
  customerId,
  loginCustomerId = "",
  accessToken,
  developerToken,
  level = "campaign",
  datePreset = "last_30d",
  range = null,
  daily = false,
  campaignId = "",
  adGroupId = "",
  fetchImpl = fetch,
  env = process.env,
  now = new Date()
}) {
  const { since, until } = googleAdsDateBounds({ datePreset, range, now });
  const query = buildGoogleAdsQuery({ level, since, until, daily, campaignId, adGroupId });
  const results = await googleAdsSearch({ customerId, query, accessToken, developerToken, loginCustomerId, fetchImpl, env });
  return { since, until, ...summarizeGoogleAdsRows(level, results, { daily }) };
}
