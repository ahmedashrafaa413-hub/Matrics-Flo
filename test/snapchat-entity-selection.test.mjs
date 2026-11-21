import test from "node:test";
import assert from "node:assert/strict";
import { couldDeliverInRange, selectReportableEntities } from "../lib/snapchatEntitySelection.mjs";

const range = { startTime: "2026-10-23T00:00:00.000+03:00", endTime: "2026-11-21T16:00:00.000+03:00" };
const S = Date.parse(range.startTime);
const E = Date.parse(range.endTime);

test("entities scheduled outside the range are skipped", () => {
  assert.equal(couldDeliverInRange({ status: "ACTIVE", start_time: "2026-12-01T00:00:00Z" }, S, E), false);
  assert.equal(couldDeliverInRange({ status: "ACTIVE", end_time: "2026-09-01T00:00:00Z" }, S, E), false);
  assert.equal(couldDeliverInRange({ status: "ACTIVE", start_time: "2026-01-01T00:00:00Z" }, S, E), true);
});

test("paused or deleted entities last changed before the range are skipped", () => {
  assert.equal(couldDeliverInRange({ status: "PAUSED", updated_at: "2026-06-01T00:00:00Z" }, S, E), false);
  assert.equal(couldDeliverInRange({ status: "DELETED", updated_at: "2026-06-01T00:00:00Z" }, S, E), false);
  assert.equal(couldDeliverInRange({ status: "PAUSED", updated_at: "2026-11-01T00:00:00Z" }, S, E), true);
  // An active entity always qualifies, however old its last change.
  assert.equal(couldDeliverInRange({ status: "ACTIVE", updated_at: "2025-01-01T00:00:00Z" }, S, E), true);
  // Missing timestamps never exclude an entity.
  assert.equal(couldDeliverInRange({ status: "PAUSED" }, S, E), true);
});

test("selection puts active, recently changed entities first and applies the limit", () => {
  const entities = [
    { id: "old-paused", status: "PAUSED", updated_at: "2026-01-01T00:00:00Z" },
    { id: "paused-recent", status: "PAUSED", updated_at: "2026-11-10T00:00:00Z" },
    { id: "active-old", status: "ACTIVE", updated_at: "2026-02-01T00:00:00Z" },
    { id: "active-new", status: "ACTIVE", updated_at: "2026-11-15T00:00:00Z" }
  ];
  const result = selectReportableEntities(entities, { ...range, limit: 2 });
  assert.deepEqual(result.selected.map((e) => e.id), ["active-new", "active-old"]);
  assert.equal(result.candidates, 3);
  assert.equal(result.skipped_out_of_range, 1);
});
