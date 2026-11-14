import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("OAuth consent route exists at the Supabase configured path", () => {
  const consent = read("app/oauth/consent/page.jsx");
  assert.match(consent, /export default function OAuthConsentPage/);
  assert.match(consent, /authorization_id/);
  assert.match(consent, /getAuthorizationDetails/);
  assert.match(consent, /approveAuthorization/);
  assert.match(consent, /denyAuthorization/);
  assert.match(consent, /\/api\/oauth\/owner-check/);
});

test("Consent authorization is restricted to the configured owner", () => {
  const guard = read("app/api/oauth/owner-check/route.js");
  assert.match(guard, /METRICSFLO_AI_OWNER_USER_ID/);
  assert.match(guard, /user\.id !== owner/);
  assert.match(guard, /account_not_authorized/);
});

test("MCP discovery advertises Supabase OAuth and disallows arbitrary origins", () => {
  const discovery = read("app/.well-known/oauth-protected-resource/mcp/route.js");
  assert.match(discovery, /authorization_servers/);
  assert.match(discovery, /bearer_methods_supported/);
  assert.match(discovery, /isApprovedOrigin/);
  assert.match(discovery, /metricsflo\.com/);
});

test("MCP requests require bearer authentication and owner authorization", () => {
  const route = read("app/api/mcp/route.js");
  assert.match(route, /Bearer authentication required/);
  assert.match(route, /user\.id !== ownerId/);
});
