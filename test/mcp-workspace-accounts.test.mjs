import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mcpRoute = await readFile(new URL("../app/api/mcp/route.js", import.meta.url), "utf8");
const dataLayer = await readFile(new URL("../lib/mcpWorkspaceData.js", import.meta.url), "utf8");
const connections = await readFile(new URL("../lib/mcpConnections.mjs", import.meta.url), "utf8");

test("MCP account discovery uses canonical platform connections", () => {
  assert.match(dataLayer, /\.from\(["']platform_connections["']\)/);
  assert.doesNotMatch(mcpRoute + dataLayer, /\.from\(["']integrations["']\)/);
  assert.match(connections, /_default/);
});

test("MCP reads workspace data directly instead of calling the app over HTTP", () => {
  assert.doesNotMatch(mcpRoute, /METRICSFLO_INTERNAL_ORIGIN/);
  assert.doesNotMatch(mcpRoute, /internalFetch/);
  assert.match(mcpRoute, /userHasWorkspaceAccess\(user\.id, workspaceId\)/);
});

test("MCP accepts explicit platform account IDs and custom ranges", () => {
  assert.match(mcpRoute, /["']snapchat_account_id["']/);
  assert.match(mcpRoute, /["']meta_account_id["']/);
  assert.match(mcpRoute, /parseCustomRange\(args\.since, args\.until\)/);
});
