import test from "node:test";
import assert from "node:assert/strict";
import { parseCustomRange, snapchatTimeRange } from "../lib/mcpDateRange.mjs";

const NOW = new Date("2026-11-21T10:00:00Z");

test("parseCustomRange returns null when no bounds are given", () => {
  assert.equal(parseCustomRange(undefined, undefined, NOW), null);
});

test("parseCustomRange validates both bounds", () => {
  assert.ok(parseCustomRange("2026-11-01", undefined, NOW).error);
  assert.ok(parseCustomRange("2026/11/01", "2026-11-02", NOW).error);
  assert.ok(parseCustomRange("2026-02-31", "2026-03-01", NOW).error);
  assert.ok(parseCustomRange("2026-11-10", "2026-11-01", NOW).error);
  assert.ok(parseCustomRange("2026-11-22", "2026-11-23", NOW).error);
  assert.ok(parseCustomRange("2025-01-01", "2026-11-01", NOW).error);
});

test("parseCustomRange accepts a valid inclusive range", () => {
  assert.deepEqual(parseCustomRange("2026-11-01", "2026-11-21", NOW), { since: "2026-11-01", until: "2026-11-21", days: 21 });
  assert.deepEqual(parseCustomRange("2026-11-05", "2026-11-05", NOW), { since: "2026-11-05", until: "2026-11-05", days: 1 });
});

test("parseCustomRange uses the Riyadh calendar day for 'future'", () => {
  // 22:30 UTC on the 21st is already the 22nd in Riyadh.
  const late = new Date("2026-11-21T22:30:00Z");
  assert.equal(parseCustomRange("2026-11-22", "2026-11-22", late).error, undefined);
});

test("snapchatTimeRange makes an exclusive Riyadh-midnight end", () => {
  assert.deepEqual(snapchatTimeRange({ since: "2026-10-01", until: "2026-10-31" }), {
    startTime: "2026-10-01T00:00:00.000+03:00",
    endTime: "2026-11-01T00:00:00.000+03:00"
  });
  assert.equal(snapchatTimeRange({ since: "2026-12-31", until: "2026-12-31" }).endTime, "2027-01-01T00:00:00.000+03:00");
});
