import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildAnalyticsSnapshot, compareMetric, normalizeCampaign, safeRatio } from "../lib/analyticsEngine.mjs";

test("analytics comparisons respect metric direction without inventing missing values", () => {
  assert.equal(safeRatio(null, 5), null);
  assert.equal(compareMetric("roas", 3, 2).improved, true);
  assert.equal(compareMetric("cpa", 80, 60).improved, false);
  assert.equal(compareMetric("cpa", 40, 60).improved, true);
  assert.equal(compareMetric("spend", 10, 0).percent, null);
});

test("campaign normalization keeps unavailable metrics null", () => {
  const row = normalizeCampaign({ campaign_id:"1", campaign_name:"Campaign", spend:"100", impressions:"1000", clicks:"20" }, "Meta Ads");
  assert.equal(row.revenue, null);
  assert.equal(row.purchases, null);
  assert.equal(row.ctr, 2);
  assert.equal(row.cpa, null);
});

test("analytics snapshot reports obvious tracking-quality conflicts", () => {
  const snapshot = buildAnalyticsSnapshot({
    current:{ total_ads_spend:100, total_sales:200, total_purchases:2, actual_roas:2, cost_per_purchase:50 },
    previous:{ total_ads_spend:80, total_sales:160, total_purchases:2, actual_roas:2, cost_per_purchase:40 },
    campaigns:[normalizeCampaign({ campaign_id:"1", campaign_name:"Broken", spend:100, impressions:0, purchases:2, revenue:0 }, "Meta Ads")],
    sources:[], freshness:{}
  });
  assert.equal(snapshot.data_quality.some((issue) => issue.code === "spend_without_impressions"), true);
  assert.equal(snapshot.data_quality.some((issue) => issue.code === "purchases_without_revenue"), true);
});

test("analytics route is workspace isolated and loads sources in parallel", async () => {
  const source = await readFile(new URL("../app/api/analytics/overview/route.js", import.meta.url), "utf8");
  assert.match(source, /getActiveWorkspace\(request\)/);
  assert.match(source, /Promise\.all\(requests\)/);
  assert.match(source, /level=campaign/);
});

test("legacy Intelligence route redirects safely to Analytics", async () => {
  const source = await readFile(new URL("../app/intelligence/page.jsx", import.meta.url), "utf8");
  assert.match(source, /redirect\("\/analytics"\)/);
});
