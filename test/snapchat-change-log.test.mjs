import test from "node:test";
import assert from "node:assert/strict";
import { categorizeField, filterChanges, parseChangeLogEntry, summarizeEntityChanges } from "../lib/snapchatChangeLog.mjs";

const raw = (id, at, records, action = "UPDATED") => ({
  sub_request_status: "SUCCESS",
  changelog: { id, event_at: at, created_at: at, name: "Squad A", action, email: "a@b.c", app_name: "Ads Manager", entity_id: "sq1", entity_type: "AD_SQUAD", ...(records ? { update_value_records: records } : {}) }
});

test("categorizes Snapchat fields", () => {
  assert.equal(categorizeField("daily_budget_micro"), "budget");
  assert.equal(categorizeField("lifetime_budget_micro"), "budget");
  assert.equal(categorizeField("bid_micro"), "bid");
  assert.equal(categorizeField("bid_strategy"), "bid");
  assert.equal(categorizeField("status"), "status");
  assert.equal(categorizeField("end_time"), "schedule");
  assert.equal(categorizeField("targeting"), "targeting");
  assert.equal(categorizeField("whatever"), "other");
});

test("parses micros, JSON strings and deltas", () => {
  const e = parseChangeLogEntry(raw("1", "2026-11-10T10:00:00.000Z", {
    daily_budget_micro: { before_value: "100000000", after_value: "150000000" },
    bid_micro: { before_value: "868402", after_value: "876174" },
    status: { before_value: '"ACTIVE"', after_value: '"PAUSED"' },
    end_time: { after_value: "1563580491000" }
  }));
  const by = Object.fromEntries(e.changes.map((c) => [c.field, c]));
  assert.deepEqual([by.daily_budget.before, by.daily_budget.after, by.daily_budget.delta, by.daily_budget.delta_pct], [100, 150, 50, 50]);
  assert.equal(by.bid.before, 0.868402);
  assert.equal(by.bid.delta, 0.007772);
  assert.equal(by.status.after, "PAUSED");
  assert.equal(by.end_time.before, null);
  assert.equal(by.end_time.after, "2019-07-19T23:54:51.000Z");
  assert.equal(by.end_time.delta, undefined);
  assert.equal(e.changed_by, "a@b.c");
  assert.deepEqual(e.categories.sort(), ["bid", "budget", "schedule", "status"]);
});

test("filters by range and category, newest first, and summarizes", () => {
  const entries = [
    raw("old", "2026-10-01T00:00:00.000Z", { daily_budget_micro: { before_value: "50000000", after_value: "100000000" } }),
    raw("a", "2026-11-05T00:00:00.000Z", { daily_budget_micro: { before_value: "100000000", after_value: "120000000" }, name: { before_value: '"x"', after_value: '"y"' } }),
    raw("b", "2026-11-08T00:00:00.000Z", { daily_budget_micro: { before_value: "120000000", after_value: "90000000" } }),
    raw("c", "2026-11-09T00:00:00.000Z", { status: { before_value: '"ACTIVE"', after_value: '"PAUSED"' } }),
    raw("created", "2026-11-02T00:00:00.000Z", null, "CREATED")
  ].map(parseChangeLogEntry);

  const all = filterChanges(entries, { start: "2026-11-01T00:00:00.000Z", end: "2026-11-21T00:00:00.000Z" });
  assert.deepEqual(all.map((e) => e.id), ["c", "b", "a", "created"]);

  const budget = filterChanges(entries, { start: "2026-11-01T00:00:00.000Z", end: "2026-11-21T00:00:00.000Z", categories: ["budget"] });
  assert.deepEqual(budget.map((e) => e.id), ["b", "a"]);
  assert.ok(budget.every((e) => e.changes.every((c) => c.category === "budget")));

  const s = summarizeEntityChanges(all);
  assert.equal(s.total_changes, 4);
  assert.deepEqual({ ...s.budget, last_change_at: undefined }, { changes: 2, increases: 1, decreases: 1, first_before: 100, last_after: 90, last_change_at: undefined });
  assert.equal(s.bid, null);
  assert.equal(s.status.changes, 1);
});

test("sub-cent bid changes keep their direction", () => {
  const e = parseChangeLogEntry(raw("x", "2026-11-10T00:00:00.000Z", { bid_micro: { before_value: "868402", after_value: "869000" } }));
  assert.equal(e.changes[0].delta, 0.000598);
  assert.equal(summarizeEntityChanges([e]).bid.increases, 1);
});
