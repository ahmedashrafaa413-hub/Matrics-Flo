// Canonical field dictionary for the read-only MCP API.
// A mapping documents terminology; it does not imply that a connector is live.
export const FIELD_DICTIONARY = Object.freeze({
  spend: { snapchat: "Amount spent", meta: "Amount spent", tiktok: "Spend", google: "Cost", type: "money" },
  impressions: { snapchat: "Paid impressions", meta: "Impressions", tiktok: "Impressions", google: "Impr.", type: "integer" },
  clicks: { snapchat: "Clicks", meta: "Outbound clicks", tiktok: "Clicks (destination)", google: "Clicks", type: "integer" },
  landing_page_views: { snapchat: "Landing Page Views", meta: "Website landing page views", tiktok: "Page views (website)", google: null, type: "integer" },
  add_to_cart: { snapchat: "Adds To Basket", meta: "Adds to cart", tiktok: "Adds to cart (website)", google: null, type: "integer" },
  checkout_initiated: { snapchat: "Checkouts Started", meta: "Checkouts initiated", tiktok: "Checkouts initiated (website)", google: null, type: "integer" },
  purchases: { snapchat: "Purchases", meta: "Purchases", tiktok: "Purchases (website)", google: "Conversions", type: "integer" },
  revenue: { snapchat: "Purchases Value", meta: "Purchases conversion value", tiktok: "Purchase value (website)", google: "Conv. value", type: "money" },
  reach: { snapchat: "Paid reach", meta: "Reach", tiktok: "Reach", google: null, type: "integer" },
  frequency: { snapchat: "Paid frequency", meta: "Frequency", tiktok: "Frequency", google: null, type: "number" },
  hook_rate: { snapchat: null, meta: "Hook Rate", tiktok: null, google: null, type: "ratio" },
  hold_rate: { snapchat: null, meta: "Hold Rate", tiktok: null, google: null, type: "ratio" }
});

// GA4 website metrics — separate from ad-platform fields.
// Source: GA4 Reporting API (ga:sessions, ga:bounceRate, etc.)
export const GA4_FIELD_DICTIONARY = Object.freeze({
  sessions: { ga4: "sessions", type: "integer", description: "Total website sessions" },
  users: { ga4: "totalUsers", type: "integer", description: "Unique users" },
  new_users: { ga4: "newUsers", type: "integer", description: "New users" },
  bounce_rate: { ga4: "bounceRate", type: "ratio", description: "Single-page session rate (0–1)" },
  avg_session_duration: { ga4: "averageSessionDuration", type: "seconds", description: "Average session length in seconds" },
  pageviews: { ga4: "screenPageViews", type: "integer", description: "Total page views" },
  pages_per_session: { ga4: "screenPageViewsPerSession", type: "number", description: "Pages viewed per session" },
  engagement_rate: { ga4: "engagementRate", type: "ratio", description: "Engaged sessions / total sessions (0–1)" },
  conversions: { ga4: "conversions", type: "integer", description: "Goal completions" },
  event_count: { ga4: "eventCount", type: "integer", description: "Total events fired" }
});

export function listCanonicalFields(platform) {
  const supported = ["snapchat", "meta", "tiktok", "google"];
  if (platform && !supported.includes(platform)) throw new Error("Unsupported platform");

  const adFields = Object.entries(FIELD_DICTIONARY).map(([name, value]) => ({
    name,
    category: "ads",
    type: value.type,
    mappings: platform ? { [platform]: value[platform] } : Object.fromEntries(supported.map((p) => [p, value[p]]))
  }));

  // GA4 fields are always included (not platform-filtered — they are website metrics, not ad metrics)
  const ga4Fields = Object.entries(GA4_FIELD_DICTIONARY).map(([name, value]) => ({
    name,
    category: "website",
    type: value.type,
    description: value.description,
    mappings: { ga4: value.ga4 }
  }));

  return [...adFields, ...ga4Fields];
}
