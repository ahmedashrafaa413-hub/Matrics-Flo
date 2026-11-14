import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pricing page includes the requested plans, prices, billing modes and honest checkout state", async () => {
  const source = await readFile(new URL("../app/pricing/page.jsx", import.meta.url), "utf8");
  for (const plan of ["Free", "Solo", "Growth", "Agency", "Enterprise"]) assert.match(source, new RegExp(plan));
  for (const price of ["990", "2490", "4990"]) assert.match(source, new RegExp(price));
  assert.match(source, /setAnnual/);
  assert.match(source, /promo-code/);
  assert.match(source, /payment gateway/);
});
