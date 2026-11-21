// Shared Meta Ads insights logic.
// Used by /api/meta/insights (browser session) and the MCP server
// (explicit workspace), so both return identical numbers.

import { buildMetaGraphUrl, fetchMetaCollection } from "./metaApi.mjs";

export const META_INSIGHT_FIELDS = [
  "account_id",
  "account_name",
  "account_currency",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "action_values",
  "video_play_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "video_thruplay_watched_actions",
  "purchase_roas",
  "date_start",
  "date_stop"
];

const PURCHASE_ACTIONS = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];
const ATC_ACTIONS = ["add_to_cart", "omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"];
const IC_ACTIONS = ["initiate_checkout", "omni_initiated_checkout", "offsite_conversion.fb_pixel_initiate_checkout"];
const VC_ACTIONS = ["view_content", "omni_view_content", "offsite_conversion.fb_pixel_view_content"];

function getActionValue(actions = [], names = []) {
  const found = actions.find((item) => names.includes(item.action_type));
  return Number(found?.value || 0);
}

function safeDivide(a, b) {
  const x = Number(a || 0);
  const y = Number(b || 0);
  if (!y) return 0;
  return x / y;
}

function getVideoMetric(row, key) {
  return Number(row?.[key]?.[0]?.value || 0);
}

function fixed(value) {
  return Number(Number(value || 0).toFixed(2));
}

export function enrichMetaRow(row) {
  const actions = row.actions || [];
  const purchases = getActionValue(actions, PURCHASE_ACTIONS);
  const addToCart = getActionValue(actions, ATC_ACTIONS);
  const initiateCheckout = getActionValue(actions, IC_ACTIONS);
  const viewContent = getActionValue(actions, VC_ACTIONS);
  const landingPageViews = getActionValue(actions, ["landing_page_view"]);
  const purchaseValue = getActionValue(row.action_values || [], PURCHASE_ACTIONS);
  const spend = Number(row.spend || 0);
  const impressions = Number(row.impressions || 0);
  const videoPlays = getVideoMetric(row, "video_play_actions");
  const thruplays = getVideoMetric(row, "video_thruplay_watched_actions");
  const videoViews = getActionValue(actions, ["video_view"]);
  const video100 = getVideoMetric(row, "video_p100_watched_actions");

  return {
    ...row,
    purchases,
    purchase_value: purchaseValue,
    add_to_cart: addToCart,
    initiate_checkout: initiateCheckout,
    view_content: viewContent,
    landing_page_views: landingPageViews,
    video_plays: videoPlays,
    thruplays,
    video_views: videoViews,
    video_25: getVideoMetric(row, "video_p25_watched_actions"),
    video_50: getVideoMetric(row, "video_p50_watched_actions"),
    video_75: getVideoMetric(row, "video_p75_watched_actions"),
    video_95: getVideoMetric(row, "video_p95_watched_actions"),
    video_100: video100,
    hook_rate: fixed(safeDivide(videoViews, impressions) * 100),
    hold_rate: fixed(safeDivide(thruplays, videoPlays) * 100),
    completion_rate: fixed(safeDivide(video100, videoPlays) * 100),
    roas: fixed(safeDivide(purchaseValue, spend)),
    cpa: fixed(safeDivide(spend, purchases)),
    cost_per_add_to_cart: fixed(safeDivide(spend, addToCart)),
    cost_per_initiate_checkout: fixed(safeDivide(spend, initiateCheckout))
  };
}

export function summarizeMetaRows(rows) {
  const summary = rows.reduce(
    (acc, row) => {
      acc.spend += Number(row.spend || 0);
      acc.impressions += Number(row.impressions || 0);
      acc.clicks += Number(row.clicks || 0);
      acc.purchases += Number(row.purchases || 0);
      acc.purchase_value += Number(row.purchase_value || 0);
      acc.add_to_cart += Number(row.add_to_cart || 0);
      acc.initiate_checkout += Number(row.initiate_checkout || 0);
      acc.view_content += Number(row.view_content || 0);
      acc.landing_page_views += Number(row.landing_page_views || 0);
      return acc;
    },
    {
      spend: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      purchase_value: 0,
      add_to_cart: 0,
      initiate_checkout: 0,
      view_content: 0,
      landing_page_views: 0
    }
  );

  summary.roas = fixed(safeDivide(summary.purchase_value, summary.spend));
  summary.cpa = fixed(safeDivide(summary.spend, summary.purchases));
  summary.cost_per_add_to_cart = fixed(safeDivide(summary.spend, summary.add_to_cart));
  summary.cost_per_initiate_checkout = fixed(safeDivide(summary.spend, summary.initiate_checkout));
  summary.lpv_rate = fixed(safeDivide(summary.landing_page_views, summary.clicks) * 100);
  summary.view_content_rate = fixed(
    safeDivide(summary.view_content, summary.landing_page_views || summary.clicks) * 100
  );
  summary.atc_rate = fixed(
    safeDivide(summary.add_to_cart, summary.view_content || summary.landing_page_views || summary.clicks) * 100
  );
  summary.checkout_rate = fixed(safeDivide(summary.initiate_checkout, summary.add_to_cart) * 100);
  summary.purchase_rate = fixed(safeDivide(summary.purchases, summary.initiate_checkout) * 100);
  summary.cart_abandonment_rate = fixed(
    summary.add_to_cart > 0 ? ((summary.add_to_cart - summary.purchases) / summary.add_to_cart) * 100 : 0
  );

  return summary;
}

export async function fetchMetaInsights({
  token,
  accountId,
  level = "campaign",
  datePreset = "maximum",
  since = "",
  until = "",
  fetchImpl = fetch
}) {
  if (!token) throw Object.assign(new Error("Not connected to Meta"), { status: 401 });
  if (!accountId) throw Object.assign(new Error("account_id is required"), { status: 400 });

  const params = new URLSearchParams({
    fields: META_INSIGHT_FIELDS.join(","),
    level,
    limit: "200"
  });

  // Custom date range takes priority over date_preset
  if (since && until) {
    params.append("time_range", JSON.stringify({ since, until }));
  } else {
    params.append("date_preset", datePreset);
  }

  const url = buildMetaGraphUrl(`${accountId}/insights`, params);
  const result = await fetchMetaCollection({ url, token, fetchImpl });
  const data = result.data.map(enrichMetaRow);

  return {
    data,
    summary: summarizeMetaRows(data),
    currency: result.data[0]?.account_currency || null,
    pages_loaded: result.pages
  };
}
