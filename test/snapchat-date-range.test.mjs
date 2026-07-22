import test from "node:test";
import assert from "node:assert/strict";
import { getDateRange } from "../lib/snapchatApi.js";

test("Snapchat maximum range is capped at twelve months", () => {
  const { startTime, endTime } = getDateRange("maximum");
  const days = (new Date(endTime) - new Date(startTime)) / 86_400_000;

  assert.ok(days >= 363, `expected at least 363 days, received ${days}`);
  assert.ok(days <= 365, `expected at most 365 days, received ${days}`);
});
