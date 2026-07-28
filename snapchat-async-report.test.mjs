import test from "node:test";
import assert from "node:assert/strict";
import { parseAsyncStatsCsv, parseCsv } from "./lib/snapchatApi.js";

test("CSV parser preserves quoted names and escaped quotes", () => {
  const rows = parseCsv(
    'Campaign ID,Campaign Name,spend\r\nabc,"حملة, الرياض",1200000\r\ndef,"Offer ""A""",300000\r\n'
  );

  assert.deepEqual(rows[1], ["abc", "حملة, الرياض", "1200000"]);
  assert.deepEqual(rows[2], ["def", 'Offer "A"', "300000"]);
});

test("async campaign report keeps every row and numeric metric", () => {
  const csv = [
    "Campaign ID,Campaign Name,spend,conversion_purchases,conversion_purchases_value,impressions,swipes",
    'campaign-1,"Active, Campaign",1486840000,39,3083370000,626898,4228',
    "campaign-2,Archived Campaign,0,2,150000000,0,0"
  ].join("\n");

  const rows = parseAsyncStatsCsv(csv, "campaign");

  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "campaign-1");
  assert.equal(rows[0].stats.conversion_purchases, 39);
  assert.equal(rows[0].stats.conversion_purchases_value, 3083370000);
  assert.equal(rows[1].stats.spend, 0);
  assert.equal(rows[1].stats.conversion_purchases, 2);
});

test("async ad squad report accepts Snapchat ad_squad ID header", () => {
  const rows = parseAsyncStatsCsv(
    "Ad Squad ID,spend,conversion_purchases\nad-squad-1,2500000,3",
    "adsquad"
  );

  assert.equal(rows[0].id, "ad-squad-1");
  assert.equal(rows[0].stats.spend, 2500000);
  assert.equal(rows[0].stats.conversion_purchases, 3);
});
