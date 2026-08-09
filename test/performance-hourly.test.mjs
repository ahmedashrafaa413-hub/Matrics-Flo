import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("hourly performance uses real Salla and GA4 data in Riyadh time", async () => {
  const route = await readFile(new URL("../app/api/performance/hourly/route.js", import.meta.url), "utf8");
  assert.match(route, /Asia\/Riyadh/);
  assert.match(route, /from\("salla_orders"\)/);
  assert.match(route, /dateHour/);
  assert.match(route, /Promise\.allSettled/);
  assert.match(route, /Array\.from\(\{ length: 24 \}/);
});

test("performance page renders hourly selector and source freshness", async () => {
  const page = await readFile(new URL("../app/performance-overview/page.jsx", import.meta.url), "utf8");
  assert.match(page, /\/api\/performance\/hourly/);
  assert.match(page, /اليوم مقابل أمس بالساعة/);
  assert.match(page, /آخر جلب/);
});
