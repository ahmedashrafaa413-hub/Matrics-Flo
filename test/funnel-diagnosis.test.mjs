import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRows, buildFunnel, diagnose, roasBand, sumFunnels } from "../lib/funnelDiagnosis.mjs";

const row = (o) => ({
  id: o.id || "x",
  name: o.name || "x",
  spend: o.spend, revenue: o.revenue ?? 0, impressions: o.impressions ?? 100000, swipes: o.swipes ?? 1000,
  view_content: o.vc ?? 0, add_to_cart: o.atc ?? 0, initiate_checkout: o.ic ?? 0, purchases: o.pur ?? 0,
  ads_manager: { "Landing Page Views": o.lpv ?? 0 },
  extended: o.video_views ? { video_views: o.video_views } : {}
});

// Account: 1,000 spend, 10 purchases (CPA 100), 100 ATC (cost 10), 40 checkouts (cost 25).
const summary = row({ spend: 1000, revenue: 3000, impressions: 1000000, swipes: 10000, lpv: 6000, vc: 3000, atc: 100, ic: 40, pur: 10 });
const bench = buildFunnel(summary);

test("buildFunnel computes costs per stage and step rates", () => {
  assert.equal(bench.roas, 3);
  assert.equal(bench.costs.purchases, 100);
  assert.equal(bench.costs.add_to_cart, 10);
  assert.equal(bench.costs.impressions, 1); // CPM
  assert.equal(bench.steps.ctr, 0.01);
  assert.equal(bench.steps.lpv_rate, 0.6);
  assert.equal(bench.has_landing, true);
});

test("sumFunnels adds counts and recomputes rates", () => {
  const a = buildFunnel(row({ spend: 10, impressions: 1000, swipes: 10, atc: 1 }));
  const b = buildFunnel(row({ spend: 30, impressions: 3000, swipes: 50, atc: 3, lpv: 20 }));
  const sum = sumFunnels([a, b]);
  assert.equal(sum.spend, 40);
  assert.equal(sum.counts.swipes, 60);
  assert.equal(sum.costs.add_to_cart, 10);
  assert.equal(sum.counts.landing_page_views, 20);
});

test("roasBand colours against the target", () => {
  assert.equal(roasBand(3.2, 3), "good");
  assert.equal(roasBand(2.1, 3), "ok");
  assert.equal(roasBand(1.5, 3), "bad");
  assert.equal(roasBand(null, 3), "none");
});

test("strong whole funnel is scaled", () => {
  const f = buildFunnel(row({ spend: 200, revenue: 900, impressions: 200000, swipes: 2200, lpv: 1300, atc: 25, ic: 10, pur: 5 }));
  assert.equal(diagnose(f, bench).verdict, "scale");
});

test("expensive add-to-basket after real spend is cut", () => {
  const f = buildFunnel(row({ spend: 150, revenue: 100, impressions: 150000, swipes: 1500, lpv: 900, atc: 3, ic: 1, pur: 1 }));
  const d = diagnose(f, bench);
  assert.equal(d.verdict, "cut");
  assert.ok(d.reasons.some((r) => r.includes("سلة")));
});

test("cheap upper funnel with no purchases yet is kept", () => {
  const f = buildFunnel(row({ spend: 60, impressions: 60000, swipes: 700, lpv: 420, atc: 8, ic: 2, pur: 0 }));
  assert.equal(diagnose(f, bench).verdict, "keep");
});

test("tiny spend is still learning", () => {
  const f = buildFunnel(row({ spend: 20, impressions: 20000, swipes: 150, lpv: 90, atc: 1 }));
  assert.equal(diagnose(f, bench).verdict, "learning");
});

test("low CTR breaks at the creative", () => {
  const f = buildFunnel(row({ spend: 120, revenue: 150, impressions: 200000, swipes: 400, lpv: 260, atc: 6, ic: 2, pur: 1 }));
  const d = diagnose(f, bench);
  assert.equal(d.break_area, "creative");
  assert.equal(d.verdict, "cut"); // checkout also 2.4x the average with ROAS 1.25
});

test("swipes that never reach the page break at the landing page", () => {
  const f = buildFunnel(row({ spend: 120, revenue: 150, impressions: 120000, swipes: 1200, lpv: 200, atc: 6, ic: 2, pur: 1 }));
  assert.equal(diagnose(f, bench).break_area, "landing");
});

test("analyzeRows uses the summary as benchmark and counts verdicts", () => {
  const rows = [
    row({ id: "a", spend: 200, revenue: 900, impressions: 200000, swipes: 2200, lpv: 1300, atc: 25, ic: 10, pur: 5 }),
    row({ id: "b", spend: 20, impressions: 20000, swipes: 150, lpv: 90, atc: 1 })
  ];
  const out = analyzeRows(rows, { summary, targetRoas: 3 });
  assert.equal(out.benchmark.costs.purchases, 100);
  assert.equal(out.items.length, 2);
  assert.equal(out.verdict_counts.scale, 1);
  assert.equal(out.verdict_counts.learning, 1);
});

test("a paused winner is flagged to revive, not scale", () => {
  const f = buildFunnel(row({ spend: 200, revenue: 900, impressions: 200000, swipes: 2200, lpv: 1300, atc: 25, ic: 10, pur: 5 }));
  assert.equal(diagnose(f, bench, { status: "PAUSED" }).verdict, "revive");
});

test("image ads (no video views) are not judged on hook rate", () => {
  const f = buildFunnel(row({ spend: 200, revenue: 900, impressions: 200000, swipes: 2200, lpv: 1300, atc: 25, ic: 10, pur: 5, video_views: 100 }));
  const b = buildFunnel({ ...summary, extended: { video_views: 110000 } });
  assert.equal(diagnose(f, b).verdict, "scale");
});
