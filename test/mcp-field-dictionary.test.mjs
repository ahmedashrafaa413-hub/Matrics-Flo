import test from "node:test";
import assert from "node:assert/strict";
import { FIELD_DICTIONARY, listCanonicalFields } from "../lib/mcpFieldDictionary.mjs";

test("canonical dictionary explicitly marks unsupported Google funnel fields as null", () => {
  assert.equal(FIELD_DICTIONARY.add_to_cart.google, null);
  assert.equal(FIELD_DICTIONARY.checkout_initiated.google, null);
  assert.equal(FIELD_DICTIONARY.landing_page_views.google, null);
});

test("list_fields returns all platforms or a selected platform", () => {
  const all = listCanonicalFields();
  assert.ok(all.some((field) => field.name === "spend"));
  assert.equal(all.find((field) => field.name === "spend").mappings.snapchat, "Amount spent");
  const meta = listCanonicalFields("meta");
  assert.deepEqual(Object.keys(meta[0].mappings), ["meta"]);
  assert.throws(() => listCanonicalFields("unknown"), /Unsupported platform/);
});
