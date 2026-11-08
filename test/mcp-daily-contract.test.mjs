import test from "node:test";
import assert from "node:assert/strict";
import { validateQueryInput, canonicalDailyRows } from "../lib/mcpDailyContract.mjs";

const base = { account_id: "12345678-1234-1234-1234-123456789012", platform: "snapchat", level: "adset", date_from: "2026-11-01", date_to: "2026-11-07" };

test("query enforces allowed platforms, date range, and arguments", () => {
  assert.equal(validateQueryInput(base).days, 7);
  assert.throws(() => validateQueryInput({ ...base, platform: "tiktok" }), /unsupported_platform/);
  assert.throws(() => validateQueryInput({ ...base, date_to: "2027-01-01" }), /date_range_too_large/);
  assert.throws(() => validateQueryInput({ ...base, extra: "x" }), /unsupported_parameter/);
});

test("daily contract excludes aggregate rows, preserves null and currency, flags today", () => {
  const rows = canonicalDailyRows([
    { date: "2026-11-08", platform: "snapchat", id: "1", name: "A", currency: "USD", spend: 10, purchases: null },
    { date: "2026-11-08", platform: "snapchat", id: "total", name: "Total of 49 results", currency: "USD", spend: 10 }
  ], { today: "2026-11-08" });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].spend, { amount: 10, currency: "USD" });
  assert.equal(rows[0].purchases, null);
  assert.equal(rows[0].is_partial, true);
});

test("daily contract rejects duplicated entity-day records", () => {
  const row = { date: "2026-11-07", platform: "meta", id: "1", name: "Campaign", currency: "SAR" };
  assert.throws(() => canonicalDailyRows([row, row], { today: "2026-11-08" }), /duplicate_entity_day/);
});
