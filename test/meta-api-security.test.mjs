import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildMetaGraphUrl,
  fetchMetaCollection,
  getMetaGraphVersion
} from "../lib/metaApi.mjs";

test("Meta uses a supported centralized Graph API version", async () => {
  assert.equal(getMetaGraphVersion(), "v26.0");
  assert.match(buildMetaGraphUrl("me/adaccounts"), /graph\.facebook\.com\/v26\.0\/me\/adaccounts/);

  async function collectFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(target) : [target];
    }));
    return nested.flat();
  }

  const files = [
    ...(await collectFiles(path.resolve("app"))),
    ...(await collectFiles(path.resolve("lib")))
  ].filter((file) => /\.(?:js|mjs)$/.test(file));
  const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));
  assert.equal(sources.some((source) => source.includes("v19.0")), false);
});

test("Meta collection loader follows every trusted pagination page", async () => {
  const calls = [];
  const pages = new Map([
    ["https://graph.facebook.com/v26.0/act_1/insights?limit=2", {
      data: [{ id: "1" }, { id: "2" }],
      paging: { next: "https://graph.facebook.com/v26.0/act_1/insights?after=two" }
    }],
    ["https://graph.facebook.com/v26.0/act_1/insights?after=two", {
      data: [{ id: "3" }]
    }]
  ]);

  const result = await fetchMetaCollection({
    url: "https://graph.facebook.com/v26.0/act_1/insights?limit=2",
    token: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(pages.get(url)), {
        status: pages.has(url) ? 200 : 404,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.deepEqual(result.data.map((row) => row.id), ["1", "2", "3"]);
  assert.equal(result.pages, 2);
  assert.equal(calls.every((call) => call.init.headers.Authorization === "Bearer secret"), true);
});

test("Meta collection loader rejects untrusted pagination URLs", async () => {
  await assert.rejects(
    fetchMetaCollection({
      url: "https://graph.facebook.com/v26.0/me/adaccounts",
      token: "secret",
      fetchImpl: async () => new Response(JSON.stringify({
        data: [{ id: "1" }],
        paging: { next: "https://attacker.example/steal-token" }
      }))
    }),
    /untrusted pagination URL/
  );
});

test("Intelligence analysis requires tenant auth, trusted origin, and rate limiting", async () => {
  const source = await readFile(
    new URL("../app/api/intelligence/analyze/route.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /assertTrustedMutation\(request\)/);
  assert.match(source, /getActiveWorkspace\(request\)/);
  assert.match(source, /consumeRateLimit\(\{/);
  assert.match(source, /scope:\s*"intelligence_analysis"/);
  assert.match(source, /\/api\/snapchat\/data\?/);
  assert.doesNotMatch(source, /\/api\/snapchat\/insights\?/);
});
