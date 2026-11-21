import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mcpRoute = await readFile(
  new URL("../app/api/mcp/route.js", import.meta.url),
  "utf8"
);

test("MCP account discovery uses canonical platform connections", () => {
  assert.match(mcpRoute, /\.from\(["']platform_connections["']\)/);
  assert.doesNotMatch(mcpRoute, /\.from\(["']integrations["']\)/);
  assert.match(mcpRoute, /meta_default/);
  assert.match(mcpRoute, /snapchat_default/);
});

test("MCP internal analytics requests carry the selected workspace", () => {
  assert.match(
    mcpRoute,
    /metricsflo_active_workspace=\$\{encodeURIComponent\(workspaceId\)\}/
  );
  assert.match(mcpRoute, /internalFetch\(url, wsId\)/);
});

test("MCP accepts explicit platform account IDs and canonicalizes production origin", () => {
  assert.match(mcpRoute, /["']snapchat_account_id["']/);
  assert.match(mcpRoute, /["']meta_account_id["']/);
  assert.match(
    mcpRoute,
    /validatedOrigin\.hostname = ["']www\.metricsflo\.com["']/
  );
});
