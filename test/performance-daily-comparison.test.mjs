import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pagePath = new URL("../app/performance-overview/page.jsx", import.meta.url);

test("performance overview compares today with yesterday and reads GA realtime", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /performanceUrl\("today"\)/);
  assert.match(source, /performanceUrl\("yesterday"\)/);
  assert.match(source, /\/api\/ga\/overview\?range=today/);
  assert.match(source, /\/api\/ga\/overview\?range=yesterday/);
  assert.match(source, /\/api\/ga\/realtime/);
  assert.match(source, /setInterval\(loadRealtime, 30000\)/);
});
