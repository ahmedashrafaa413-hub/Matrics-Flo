import test from "node:test";
import assert from "node:assert/strict";
import {
  getSafeInternalPath,
  getSupabasePublicConfig,
  normalizeSessionMaxAge
} from "./lib/authFoundation.mjs";

test("safe redirects keep valid internal paths", () => {
  assert.equal(
    getSafeInternalPath("/dashboard?range=30d#summary"),
    "/dashboard?range=30d#summary"
  );
});

test("safe redirects reject external and protocol-relative targets", () => {
  for (const value of [
    "https://attacker.example",
    "//attacker.example/path",
    "/\\attacker.example",
    "javascript:alert(1)",
    null
  ]) {
    assert.equal(getSafeInternalPath(value), "/dashboard");
  }
});

test("session max age is bounded and rejects invalid values", () => {
  assert.equal(normalizeSessionMaxAge("3600"), 3600);
  assert.equal(normalizeSessionMaxAge(-1), 3600);
  assert.equal(normalizeSessionMaxAge("invalid"), 3600);
  assert.equal(normalizeSessionMaxAge(60 * 60 * 24 * 30), 60 * 60 * 24 * 7);
});

test("Supabase public configuration fails with actionable errors", () => {
  assert.throws(
    () => getSupabasePublicConfig({}),
    /NEXT_PUBLIC_SUPABASE_URL/
  );
  assert.throws(
    () => getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" }),
    /NEXT_PUBLIC_SUPABASE_ANON_KEY/
  );
  assert.deepEqual(
    getSupabasePublicConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key"
    }),
    { url: "https://example.supabase.co", anonKey: "anon-key" }
  );
});
