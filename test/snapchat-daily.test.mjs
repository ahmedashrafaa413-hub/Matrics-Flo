import test from "node:test";
import assert from "node:assert/strict";
import { bucketDate, dailyRows, missingParents, parseTimeseries, sumDaily } from "../lib/snapchatDaily.mjs";

const day = (start, spend, purchases, value) => ({
  start_time: `${start}T00:00:00.000+03:00`,
  end_time: null,
  stats: { spend: spend * 1e6, conversion_purchases: purchases, conversion_purchases_value: value * 1e6, impressions: 1000, swipes: 10 }
});

test("sums day buckets into range totals", () => {
  const data = { timeseries_stats: [{ timeseries_stat: { timeseries: [day("2026-11-15", 20, 1, 60), day("2026-11-16", 30, 2, 90)] } }] };
  const { totals, days } = parseTimeseries(data);
  assert.equal(days.length, 2);
  assert.equal(totals.spend, 50e6);
  assert.equal(totals.conversion_purchases, 3);
  assert.equal(totals.impressions, 2000);
});

test("empty or odd responses give no days", () => {
  assert.deepEqual(parseTimeseries({}), { totals: {}, days: [] });
  assert.deepEqual(parseTimeseries(null), { totals: {}, days: [] });
});

test("daily rows use the account's local date, oldest first, with derived ratios", () => {
  const rows = dailyRows([day("2026-11-16", 30, 2, 90), day("2026-11-15", 20, 0, 0)]);
  assert.deepEqual(rows.map((r) => r.date), ["2026-11-15", "2026-11-16"]);
  assert.equal(rows[1].roas, 3);
  assert.equal(rows[1].cpa, 15);
  assert.equal(rows[0].cpa, 0);
  assert.equal(rows[0].ctr, 1);
  assert.equal(bucketDate("2026-11-15T00:00:00.000+03:00"), "2026-11-15");
  assert.equal(bucketDate(undefined), null);
});

test("sums rows into one account-wide day list", () => {
  const a = dailyRows([day("2026-11-15", 20, 1, 60)]);
  const b = dailyRows([day("2026-11-15", 10, 1, 20), day("2026-11-16", 5, 0, 0)]);
  const total = sumDaily([a, b, undefined]);
  assert.equal(total.length, 2);
  assert.equal(total[0].spend, 30);
  assert.equal(total[0].purchases, 2);
  assert.equal(total[0].roas, 2.67);
  assert.equal(total[1].roas, 0);
});

test("names campaigns whose ad squads were not fully covered", () => {
  const parents = [
    { id: "c1", name: "full", spend: 100 },
    { id: "c2", name: "half", spend: 200 },
    { id: "c3", name: "none", spend: 50 },
    { id: "c4", name: "tiny gap", spend: 100 }
  ];
  const rows = [
    { campaign_id: "c1", spend: 100 },
    { campaign_id: "c2", spend: 60 }, { campaign_id: "c2", spend: 40 },
    { campaign_id: "c4", spend: 99.5 }
  ];
  const missing = missingParents(parents, rows);
  assert.deepEqual(missing.map((m) => m.id), ["c2", "c3"]);
  assert.equal(missing[0].covered_spend, 100);
});
