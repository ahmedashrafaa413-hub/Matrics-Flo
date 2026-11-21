import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const authorizeRoute = await readFile(
  new URL("../app/authorize/route.js", import.meta.url),
  "utf8"
);

test("ChatGPT OAuth locale hint is accepted by the authorize proxy", () => {
  assert.match(
    authorizeRoute,
    /const ALLOWED_PARAMS = new Set\([\s\S]*["']ui_locales["'][\s\S]*\)/
  );
});

test("authorize proxy still rejects parameters outside the allowlist", () => {
  assert.match(
    authorizeRoute,
    /searchParams\.keys\(\)\][\s\S]*!ALLOWED_PARAMS\.has\(k\)/
  );
});
