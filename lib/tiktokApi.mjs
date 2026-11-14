import { getReportingPeriod } from "./reportingPeriod.mjs";

export const TIKTOK_API_BASE = "https://business-api.tiktok.com/open_api/v2.0";

function apiError(payload, fallback) {
  const error = new Error(payload?.message || payload?.subcode || fallback);
  error.code = payload?.subcode || String(payload?.code || "tiktok_api_error");
  error.status = 502;
  return error;
}

export async function tiktokRequest(path, { token = "", method = "GET", body, params } = {}) {
  const url = new URL(`${TIKTOK_API_BASE}/${String(path).replace(/^\/+|\/+$/g, "")}/`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  }
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(token ? { "Access-Token": token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || Number(payload.code) !== 0) {
    throw apiError(payload, `TikTok API request failed (${response.status})`);
  }
  return payload.data || {};
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeReportRow(item, currency) {
  const metrics = item?.metrics || item || {};
  const dimensions = item?.dimensions || {};
  const spend = number(metrics.spend);
  const purchases = number(metrics.complete_payment || metrics.conversion);
  const roas = number(metrics.complete_payment_roas);
  const purchaseValue = roas > 0 ? spend * roas : number(metrics.total_purchase_value);
  return {
    campaign_id: dimensions.campaign_id || metrics.campaign_id || "",
    campaign_name: metrics.campaign_name || dimensions.campaign_name || dimensions.campaign_id || "",
    currency: metrics.currency || currency || "SAR",
    spend,
    impressions: number(metrics.impressions),
    clicks: number(metrics.clicks),
    ctr: number(metrics.ctr),
    cpc: number(metrics.cpc),
    purchases,
    purchase_value: purchaseValue,
    revenue: purchaseValue,
    roas,
    cpa: number(metrics.cost_per_complete_payment || metrics.cost_per_conversion) || (purchases ? spend / purchases : null)
  };
}

export async function getTikTokReport({ token, advertiserId, datePreset, level = "campaign", currency = "SAR" }) {
  const period = getReportingPeriod(datePreset, { timeZone: "Asia/Riyadh" });
  const dimensions = level === "campaign" ? ["campaign_id"] : [];
  const metrics = [
    ...(level === "campaign" ? ["campaign_name"] : []),
    "currency", "spend", "impressions", "clicks", "ctr", "cpc",
    "conversion", "cost_per_conversion", "complete_payment",
    "cost_per_complete_payment", "complete_payment_roas", "total_purchase_value"
  ];
  const common = {
    advertiser_ids: [String(advertiserId)], dimensions, metrics,
    start_date: period.from, end_date: period.to, page: 1, page_size: 1000
  };
  let data;
  try {
    data = await tiktokRequest("report/integrated/get", { token, params: common });
  } catch (error) {
    // Some accounts do not expose commerce attribution metrics. Delivery data
    // must still remain available, while unavailable revenue stays zero/null.
    data = await tiktokRequest("report/integrated/get", {
      token,
      params: { ...common, metrics: metrics.filter((metric) => !["complete_payment", "cost_per_complete_payment", "complete_payment_roas", "total_purchase_value"].includes(metric)) }
    });
  }
  return (data.list || []).map((item) => normalizeReportRow(item, currency));
}

export function summarizeTikTokRows(rows = [], currency = "SAR") {
  const total = rows.reduce((summary, row) => ({
    spend: summary.spend + number(row.spend), impressions: summary.impressions + number(row.impressions),
    clicks: summary.clicks + number(row.clicks), purchases: summary.purchases + number(row.purchases),
    purchase_value: summary.purchase_value + number(row.purchase_value)
  }), { spend:0, impressions:0, clicks:0, purchases:0, purchase_value:0 });
  return { ...total, currency, roas: total.spend ? total.purchase_value / total.spend : null,
    cpa: total.purchases ? total.spend / total.purchases : null };
}
