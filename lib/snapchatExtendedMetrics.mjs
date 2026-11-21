// Every Snapchat stat field the MCP connector asks for beyond the core set
// in lib/snapchatApi.js FIELDS (see Snap Marketing API "Measurement").
//
// The core set is verified in production. These extra fields are requested
// in the same stats call; if Snapchat rejects the call (one field it does not
// accept for this entity is enough), the caller retries with the core set
// only and reports the error, so the core numbers never break.

const CONVERSION_EVENTS = [
  "save", "sign_ups", "searches", "level_completes", "app_opens", "page_views",
  "subscribe", "ad_click", "ad_view", "complete_tutorial", "invite", "login",
  "share", "reserve", "achievement_unlocked", "add_to_wishlist", "spend_credits",
  "rate", "start_trial", "list_view"
];

const COUNT_FIELDS = [
  "video_views", "video_views_time_based", "video_views_5s", "video_views_15s", "engaged_views",
  "story_opens", "story_completes", "landing_page_views", "profile_clicks",
  "attachment_quartile_1", "attachment_quartile_2", "attachment_quartile_3",
  "attachment_view_completion", "attachment_video_views",
  "android_installs", "ios_installs", "total_installs",
  "native_leads", "shares", "saves", "paid_impressions", "earned_impressions",
  ...CONVERSION_EVENTS.map((e) => `conversion_${e}`),
  "custom_event_1", "custom_event_2", "custom_event_3", "custom_event_4", "custom_event_5"
];

// Money in micro-currency.
const MICROS_FIELDS = [
  "coupon_used_local",
  ...CONVERSION_EVENTS.map((e) => `conversion_${e}_value`),
  "conversion_add_cart_value", "conversion_start_checkout_value", "conversion_view_content_value",
  "conversion_add_billing_value"
];

const MILLIS_FIELDS = ["attachment_total_view_time_millis"];

// Per-entity values that cannot be summed across entities.
const NON_ADDITIVE_FIELDS = ["uniques", "frequency", "attachment_uniques", "attachment_frequency"];

export const EXTENDED_FIELDS = [...COUNT_FIELDS, ...MICROS_FIELDS, ...MILLIS_FIELDS, ...NON_ADDITIVE_FIELDS];

const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const fix2 = (v) => Number(num(v).toFixed(2));
const ratio = (a, b, k = 1) => (num(b) ? fix2((num(a) / num(b)) * k) : 0);

// Readable extended metrics from raw Snapchat stats. Only non-zero values
// are returned, so rows stay small. Pass { summed: true } for totals added up
// over several entities: reach and frequency are then left out, because
// unique users cannot be added across campaigns.
export function buildExtendedMetrics(stats = {}, { summed = false } = {}) {
  const out = {};
  const put = (key, value) => {
    if (num(value) !== 0) out[key] = value;
  };
  for (const f of COUNT_FIELDS) put(f, num(stats[f]));
  for (const f of MICROS_FIELDS) put(f.replace(/_local$/, ""), fix2(num(stats[f]) / 1e6));
  put("attachment_total_view_time_sec", fix2(num(stats.attachment_total_view_time_millis) / 1000));
  if (!summed) {
    put("reach", num(stats.uniques));
    put("frequency", fix2(stats.frequency));
    put("attachment_reach", num(stats.attachment_uniques));
    put("attachment_frequency", fix2(stats.attachment_frequency));
  }

  // Rates recomputed from totals so they are right for summed rows too.
  const imp = num(stats.impressions);
  const swipes = num(stats.swipes);
  put("video_view_rate", ratio(stats.video_views, imp, 100));
  put("cost_per_video_view", ratio(num(stats.spend) / 1e6, stats.video_views));
  put("view_rate_15s", ratio(stats.video_views_15s, imp, 100));
  put("avg_screen_time_sec", ratio(num(stats.screen_time_millis) / 1000, imp));
  put("landing_page_view_rate", ratio(stats.landing_page_views, swipes, 100));
  put("attachment_avg_view_time_sec", ratio(num(stats.attachment_total_view_time_millis) / 1000, swipes));
  return out;
}

export const EXTENDED_NOTE =
  "extended holds every other Snapchat metric with a non-zero value: video_views (2s+ or swipe), video_views_5s, video_views_15s, engaged_views, reach and frequency (per row only), story_opens, landing_page_views, profile_clicks, attachment metrics, installs, leads, every other pixel event with its _value, coupon_used, and derived rates.";
