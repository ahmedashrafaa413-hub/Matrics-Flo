import test from "node:test";
import assert from "node:assert/strict";
import {
  extractBreakdownStats,
  getDateRange,
  mergeBreakdownEntities
} from "../lib/snapchatApi.js";

test("Snapchat maximum range is capped at twelve months", () => {
  const { startTime, endTime } = getDateRange("maximum");
  const days = (new Date(endTime) - new Date(startTime)) / 86_400_000;

  assert.ok(days >= 363, `expected at least 363 days, received ${days}`);
  assert.ok(days <= 365, `expected at most 365 days, received ${days}`);
});

test("Snapchat today range covers the complete Riyadh account day", () => {
  const { startTime, endTime } = getDateRange("today");

  assert.match(startTime, /T00:00:00\.000\+03:00$/);
  assert.match(endTime, /T00:00:00\.000\+03:00$/);
  assert.equal(new Date(endTime) - new Date(startTime), 86_400_000);
});

test("deleted Snapchat ads remain in reports so attributed sales are not lost", () => {
  const rows = mergeBreakdownEntities(
    [
      { id: "active-ad", stats: { conversion_purchases: 2 } },
      { id: "deleted-ad", stats: { conversion_purchases: 15 } }
    ],
    [{ id: "active-ad", name: "Active Ad", status: "ACTIVE" }]
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].entity_name, "Active Ad");
  assert.equal(rows[1].status, "ARCHIVED");
  assert.equal(rows[1].metrics.purchases, 15);
});

test("Snapchat breakdown rows are extracted from the documented response", () => {
  const rows = extractBreakdownStats(
    {
      total_stats: [
        {
          total_stat: {
            breakdown_stats: {
              adsquad: [
                { id: "squad-1", stats: { spend: 1_500_000, impressions: 20 } }
              ]
            }
          }
        }
      ]
    },
    "adsquad"
  );

  assert.deepEqual(rows, [
    { id: "squad-1", stats: { spend: 1_500_000, impressions: 20 } }
  ]);
});
