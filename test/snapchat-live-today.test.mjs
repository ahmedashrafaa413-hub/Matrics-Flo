import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("app/snapchat/page.jsx", "utf8");
const dataRoute = readFileSync("app/api/snapchat/data/route.js", "utf8");

test("Snapchat Today auto-refreshes on the documented fifteen minute cadence", () => {
  assert.match(page, /15 \* 60_000/);
  assert.match(page, /runSync\(\{ automatic: true \}\)/);
  assert.match(page, /syncingRef\.current/);
});

test("Snapchat hierarchy reads every cached page instead of the first page only", () => {
  assert.match(page, /page_size: 200/);
  assert.match(page, /response\?\.has_more/);
  assert.match(page, /completeRows\.push/);
});

test("Snapchat data exposes the exact last completed sync timestamp", () => {
  assert.match(dataRoute, /last_synced_at:/);
  assert.match(page, /formatLastUpdated\(cacheInfo\?\.lastSyncedAt\)/);
});
