import test from "node:test";
import assert from "node:assert/strict";
import { parseAsyncStatsCsv } from "../lib/snapchatApi.js";

test("Snapchat async CSV parser discovers the header after report metadata", () => {
  const csv = [
    "Snapchat Ads Report",
    'Date Range,"Aug 2, 2026"',
    "Ad Squad ID,Spend,Conversion Purchases,Conversion Purchases Value,Impressions,Swipes",
    "squad-1,1225090000,19,1497940000,473863,3222"
  ].join("\n");

  assert.deepEqual(parseAsyncStatsCsv(csv, "adsquad"), [
    {
      id: "squad-1",
      stats: {
        spend: 1225090000,
        conversion_purchases: 19,
        conversion_purchases_value: 1497940000,
        impressions: 473863,
        swipes: 3222
      }
    }
  ]);
});

test("Snapchat async CSV parser treats a metadata-only report as empty", () => {
  assert.deepEqual(parseAsyncStatsCsv("Snapchat Ads Report\nNo data available", "adsquad"), []);
});

test("Snapchat async CSV parser discovers an undocumented entity column by known IDs", () => {
  const csv = [
    "Snapchat Ads Report",
    "Object Reference,Spend,Conversion Purchases,Impressions",
    "squad-known-2,4000000,3,1000"
  ].join("\n");

  assert.deepEqual(
    parseAsyncStatsCsv(csv, "adsquad", ["squad-known-1", "squad-known-2"]),
    [{
      id: "squad-known-2",
      stats: { spend: 4000000, conversion_purchases: 3, impressions: 1000 }
    }]
  );
});
