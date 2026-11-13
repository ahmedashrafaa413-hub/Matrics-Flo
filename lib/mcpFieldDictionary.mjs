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
export function listCanonicalFields(platform) {
  const supported = ["snapchat", "meta", "tiktok", "google"];
  if (platform && !supported.includes(platform)) throw new Error("Unsupported platform");
  return Object.entries(FIELD_DICTIONARY).map(([name, value]) => ({
    name, type: value.type, mappings: platform ? { [platform]: value[platform] } : Object.fromEntries(supported.map((p) => [p, value[p]]))
  }));
}
