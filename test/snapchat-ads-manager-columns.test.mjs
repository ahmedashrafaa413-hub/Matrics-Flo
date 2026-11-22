import test from "node:test";
import assert from "node:assert/strict";
import { buildAdsManagerColumns, entitySettings, sentenceCase } from "../lib/snapchatAdsManagerColumns.mjs";
import { withTotalNames } from "../lib/snapchatApi.js";

// Ad set "21 Nov_WF_Ben_TC8" from an Ashkalstore Ads Manager export, with the
// raw stats in micro-currency (Ads Manager rounds after dividing, so spend
// and value carry more digits than the export shows).
const raw = {
  spend: 16_224_900, impressions: 9854, swipes: 74, uniques: 8082, frequency: 1.21926,
  video_views_15s: 112, landing_page_views: 36,
  conversion_page_views: 80, conversion_page_views_web: 80,
  conversion_view_content: 70, conversion_view_content_web: 57,
  conversion_add_cart: 6, conversion_add_cart_web: 6,
  conversion_start_checkout: 6, conversion_start_checkout_web: 6,
  conversion_purchases: 4, conversion_purchases_web: 4,
  conversion_purchases_value: 133_606_000, conversion_purchases_value_web: 133_606_000
};
const squad = {
  id: "8557c80e-840a-4ef0-ae27-3e4eca8be42f", name: "21 Nov_WF_Ben_TC8", status: "ACTIVE",
  campaign_id: "fe0fff3a-1a50-4853-b7b3-0fb5aafd3c1b", campaign_name: "AA_Beard_Sales_Testing",
  settings: entitySettings({ daily_budget_micro: 40_000_000, optimization_goal: "PIXEL_PURCHASE", bid_micro: 8_000_000, bid_strategy: "TARGET_COST" })
};

test("ad set row matches the Ads Manager export columns and values", () => {
  const row = buildAdsManagerColumns(raw, { level: "adsquad", entity: squad });
  const expected = {
    "Campaign ID": "fe0fff3a-1a50-4853-b7b3-0fb5aafd3c1b", "Campaign name": "AA_Beard_Sales_Testing",
    "Ad set ID": "8557c80e-840a-4ef0-ae27-3e4eca8be42f", "Ad set name": "21 Nov_WF_Ben_TC8",
    "Ad set active status": "Active", "Ad set daily budget": 40, "Ad set lifetime budget": null,
    "Ad set goal": "Pixel purchase", "Ad set bid": 8, "Ad set frequency cap": null,
    "Result": 4, "Result type": "conversion_purchases", "Cost per result": 4.06, "Cost per result type": "COST_PER_PURCHASE",
    "Amount spent": 16.22, "Paid impressions": 9854, "Paid eCPM": 1.65, "Paid reach": 8082, "Paid frequency": 1.2193,
    "Cost per 15-second video view": 0.14, "Clicks": 74, "Click rate": 0.0075, "eCPC": 0.22,
    "Landing Page Views": 36, "Cost per landing page view": 0.45,
    "Pages Viewed": 80, "Pages Viewed Web": 80, "Cost per page viewed": 0.2,
    "Content Viewed": 70, "Content Viewed Web": 57, "Cost Per Content Viewed": 0.23,
    "Adds To Basket": 6, "Adds To Basket Web": 6, "Cost per add to basket": 2.7,
    "Checkouts Started": 6, "Checkouts Started Web": 6, "Cost per checkout started": 2.7,
    "Purchases": 4, "Purchases Web": 4, "Cost per purchase": 4.06,
    "Purchases Value": 133.61, "Purchases Value Web": 133.61, "Purchase Roas": 8.23
  };
  assert.deepEqual(row, expected);
  assert.deepEqual(Object.keys(row), Object.keys(expected));
});

test("summed rows leave out reach and frequency", () => {
  const row = buildAdsManagerColumns(raw, { level: "adsquad", summed: true });
  assert.equal("Paid reach" in row, false);
  assert.equal("Paid frequency" in row, false);
  assert.equal(row["Amount spent"], 16.22);
});

test("settings, labels and source-suffixed totals", () => {
  assert.equal(sentenceCase("PIXEL_PURCHASE"), "Pixel purchase");
  assert.deepEqual(entitySettings({ lifetime_budget_micro: 500_000_000, cap_and_exclusion_config: { frequency_cap_config: [{ frequency_cap_count: 2, time_interval: 1, frequency_cap_interval: "DAYS" }] } }),
    { lifetime_budget: 500, frequency_cap: "2 per 1 days" });
  assert.deepEqual(withTotalNames({ conversion_purchases_total: 5, conversion_purchases_web: 4, spend: 1 }),
    { conversion_purchases_total: 5, conversion_purchases_web: 4, spend: 1, conversion_purchases: 5 });
  assert.deepEqual(withTotalNames({ conversion_purchases: 3, conversion_purchases_total: 5 }), { conversion_purchases: 3, conversion_purchases_total: 5 });
});

test("summed columns keep a shared goal and mark mixed goals", () => {
  const stats = { spend: 10_000_000, swipes: 25, conversion_purchases: 2, impressions: 1000 };
  const swipes = buildAdsManagerColumns(stats, { summed: true, goal: "SWIPES" });
  assert.equal(swipes["Result"], 25);
  assert.equal(swipes["Cost per result"], 0.4);
  assert.equal(swipes["Cost per result type"], "COST_PER_SWIPE");
  const mixed = buildAdsManagerColumns(stats, { summed: true, goal: "mixed" });
  assert.equal(mixed["Result"], null);
  assert.equal(mixed["Cost per result"], null);
  assert.equal(mixed["Result type"], "mixed");
  assert.equal(mixed["Purchases"], 2);
});
