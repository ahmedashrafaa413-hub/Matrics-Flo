import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/api/mcp/route.js", import.meta.url), "utf8");

test("private MCP remains disabled unless owner ID is configured", () => {
  assert.match(source, /METRICSFLO_AI_OWNER_USER_ID/);
  assert.match(source, /if \(!ownerId\)/);
  assert.match(source, /user\.id !== ownerId/);
});

test("MCP requires bearer auth and checks workspace membership", () => {
  assert.match(source, /authorization/);
  assert.match(source, /Bearer /);
  assert.match(source, /userHasWorkspaceAccess\(user\.id, workspaceId\)/);
});

test("MCP uses a configured internal origin and bounded reads", () => {
  assert.match(source, /METRICSFLO_INTERNAL_ORIGIN/);
  assert.match(source, /consumeRateLimit/);
  assert.match(source, /responseText\.length > 512000/);
  assert.match(source, /AbortSignal\.timeout\(25000\)/);
});

test("MCP only advertises read-only overview", () => {
  assert.match(source, /get_performance_overview/);
  assert.doesNotMatch(source, /delete_campaign|update_budget|pause_ad/);
});
