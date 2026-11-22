// Snapchat Ads Manager columns, named and rounded as in its ad set export
// (Campaign name, Ad set daily budget, Result, Paid eCPM, Purchases Web, ...),
// built from raw Snapchat stats plus the entity's own settings.
//
// Raw stats come from the stats endpoint with conversion_source_types=total,web,
// which adds a "_web" twin for every conversion field (conversion_purchases_web).

const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round = (v, d = 2) => Number(num(v).toFixed(d));
const per = (a, b, d = 2) => (num(b) ? round(num(a) / num(b), d) : 0);
const micros = (v) => num(v) / 1e6;

// optimization_goal -> the stat it counts as "Result", and Ads Manager's labels.
const RESULTS = {
  PIXEL_PURCHASE: ["conversion_purchases", "COST_PER_PURCHASE"],
  PIXEL_ADD_TO_CART: ["conversion_add_cart", "COST_PER_ADD_TO_CART"],
  PIXEL_PAGE_VIEW: ["conversion_page_views", "COST_PER_PAGE_VIEW"],
  PIXEL_SIGNUP: ["conversion_sign_ups", "COST_PER_SIGN_UP"],
  LANDING_PAGE_VIEW: ["landing_page_views", "COST_PER_LANDING_PAGE_VIEW"],
  SWIPES: ["swipes", "COST_PER_SWIPE"],
  IMPRESSIONS: ["impressions", "COST_PER_IMPRESSION"],
  VIDEO_VIEWS: ["video_views", "COST_PER_VIDEO_VIEW"],
  VIDEO_VIEWS_15_SEC: ["video_views_15s", "COST_PER_15_SEC_VIDEO_VIEW"],
  STORY_OPENS: ["story_opens", "COST_PER_STORY_OPEN"],
  APP_INSTALLS: ["total_installs", "COST_PER_INSTALL"],
  LEAD_FORM_SUBMISSIONS: ["native_leads", "COST_PER_LEAD"]
};

// "PIXEL_PURCHASE" -> "Pixel purchase", "ACTIVE" -> "Active".
export function sentenceCase(value) {
  if (!value) return null;
  const s = String(value).toLowerCase().replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : null;
}

// The settings Ads Manager shows next to an ad squad (or campaign), from the
// raw Snapchat entity. Money in account currency.
export function entitySettings(raw = {}) {
  const out = {};
  if (raw.daily_budget_micro != null) out.daily_budget = round(micros(raw.daily_budget_micro));
  const lifetime = raw.lifetime_budget_micro ?? raw.lifetime_spend_cap_micro;
  if (lifetime != null) out.lifetime_budget = round(micros(lifetime));
  if (raw.optimization_goal) out.goal = raw.optimization_goal;
  const bid = raw.bid_micro ?? raw.target_bid_micro;
  if (bid != null) out.bid = round(micros(bid));
  if (raw.bid_strategy) out.bid_strategy = raw.bid_strategy;
  const cap = raw.cap_and_exclusion_config?.frequency_cap_config?.[0];
  if (cap?.frequency_cap_count != null) {
    out.frequency_cap = `${cap.frequency_cap_count} per ${cap.time_interval ?? ""} ${String(cap.frequency_cap_interval || "").toLowerCase()}`.replace(/\s+/g, " ").trim();
  }
  if (raw.objective) out.objective = raw.objective;
  return out;
}

const STATUS_LABEL = { ACTIVE: "Active", PAUSED: "Paused", DELETED: "Deleted", ARCHIVED: "Archived", PENDING: "Pending" };

// One row of Ads Manager columns. entity: { id, name, status, settings,
// campaign_id, campaign_name } at ad squad level. summed: totals over several
// entities, where reach and frequency cannot be added up and are left out.
export function buildAdsManagerColumns(stats = {}, { level = "adsquad", entity = null, summed = false } = {}) {
  const spend = micros(stats.spend);
  const imp = num(stats.impressions);
  const clicks = num(stats.swipes);
  const s = entity?.settings || {};
  const [resultField, resultType] = RESULTS[s.goal] || RESULTS.PIXEL_PURCHASE;
  const result = num(stats[resultField]);
  const value = micros(stats.conversion_purchases_value);
  const valueWeb = micros(stats.conversion_purchases_value_web);

  const out = {};
  if (entity && level === "adsquad") {
    if (entity.campaign_id) out["Campaign ID"] = entity.campaign_id;
    if (entity.campaign_name) out["Campaign name"] = entity.campaign_name;
    out["Ad set ID"] = entity.id;
    out["Ad set name"] = entity.name;
    out["Ad set active status"] = STATUS_LABEL[entity.status] || sentenceCase(entity.status);
    out["Ad set daily budget"] = s.daily_budget ?? null;
    out["Ad set lifetime budget"] = s.lifetime_budget ?? null;
    out["Ad set goal"] = sentenceCase(s.goal);
    out["Ad set bid"] = s.bid ?? null;
    out["Ad set frequency cap"] = s.frequency_cap ?? null;
  } else if (entity && level === "campaign") {
    out["Campaign ID"] = entity.id;
    out["Campaign name"] = entity.name;
    out["Campaign active status"] = STATUS_LABEL[entity.status] || sentenceCase(entity.status);
    out["Campaign daily budget"] = s.daily_budget ?? null;
    out["Campaign lifetime budget"] = s.lifetime_budget ?? null;
    out["Campaign objective"] = sentenceCase(s.objective);
  }
  Object.assign(out, {
    "Result": result,
    "Result type": resultField,
    "Cost per result": per(spend, result),
    "Cost per result type": resultType,
    "Amount spent": round(spend),
    "Paid impressions": imp,
    "Paid eCPM": per(spend * 1000, imp)
  });
  if (!summed) {
    out["Paid reach"] = num(stats.uniques);
    out["Paid frequency"] = round(stats.frequency, 4);
  }
  Object.assign(out, {
    "Cost per 15-second video view": per(spend, stats.video_views_15s),
    "Clicks": clicks,
    "Click rate": per(clicks, imp, 4),
    "eCPC": per(spend, clicks),
    "Landing Page Views": num(stats.landing_page_views),
    "Cost per landing page view": per(spend, stats.landing_page_views),
    "Pages Viewed": num(stats.conversion_page_views),
    "Pages Viewed Web": num(stats.conversion_page_views_web),
    "Cost per page viewed": per(spend, stats.conversion_page_views),
    "Content Viewed": num(stats.conversion_view_content),
    "Content Viewed Web": num(stats.conversion_view_content_web),
    "Cost Per Content Viewed": per(spend, stats.conversion_view_content),
    "Adds To Basket": num(stats.conversion_add_cart),
    "Adds To Basket Web": num(stats.conversion_add_cart_web),
    "Cost per add to basket": per(spend, stats.conversion_add_cart),
    "Checkouts Started": num(stats.conversion_start_checkout),
    "Checkouts Started Web": num(stats.conversion_start_checkout_web),
    "Cost per checkout started": per(spend, stats.conversion_start_checkout),
    "Purchases": num(stats.conversion_purchases),
    "Purchases Web": num(stats.conversion_purchases_web),
    "Cost per purchase": per(spend, stats.conversion_purchases),
    "Purchases Value": round(value),
    "Purchases Value Web": round(valueWeb),
    "Purchase Roas": per(value, spend)
  });
  return out;
}

export const ADS_MANAGER_NOTE =
  "ads_manager holds the Snapchat Ads Manager ad set export columns under their Ads Manager names. " +
  "\"X Web\" counts only website (Pixel/CAPI web) conversions; \"X\" is all sources. Click rate is a fraction (0.0075 = 0.75%). " +
  "Paid reach and Paid frequency are per row only (unique users cannot be added across rows).";
