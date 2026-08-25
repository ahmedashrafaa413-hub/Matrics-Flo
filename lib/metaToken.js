// lib/metaToken.js
// ─────────────────────────────────────────────────────────────────────────────
// Workspace-scoped Meta (Facebook/Instagram Ads) token storage.
//
// Tokens live in the `platform_connections` table (provider="meta",
// account_id="meta_default"), keyed by workspace_id — same pattern as
// Snapchat. Previously Meta tokens were saved to a separate `meta_connections`
// table under a hardcoded user_id of "default_user" (shared by literally
// every user of the app), while the read side only ever checked a
// browser-only `meta_token` cookie that the OAuth callback never even set.
// That meant Meta was effectively non-functional for real, multi-user use.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getPlatformConnection,
  upsertPlatformConnection,
  updatePlatformConnection
} from "./platformConnections";
import { buildMetaGraphUrl } from "./metaApi.mjs";

const DEFAULT_ACCOUNT_ID = "meta_default";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

// Meta doesn't use refresh tokens the way OAuth2 typically does — a
// long-lived user access token (~60 days) can be re-exchanged for a fresh
// long-lived token using the same fb_exchange_token flow.
export async function refreshMetaToken(currentAccessToken) {
  if (!currentAccessToken) throw new Error("Missing Meta access token to refresh");

  const appId = getRequiredEnv("META_APP_ID");
  const appSecret = getRequiredEnv("META_APP_SECRET");

  const url = buildMetaGraphUrl("oauth/access_token");
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: currentAccessToken
    })
  });
  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(data?.error?.message || "Meta token refresh failed");
  }

  return {
    accessToken: data.access_token,
    expiresIn: Number(data.expires_in || 60 * 24 * 60 * 60) // default ~60 days
  };
}

// ── Main export — call as getMetaToken(request) from any route ────────────────
export async function getMetaToken(request) {
  if (!request) {
    throw new Error(
      "getMetaToken(request) requires a request object to resolve the workspace"
    );
  }

  const { workspace, connection } = await getPlatformConnection({
    request,
    provider: "meta",
    accountId: DEFAULT_ACCOUNT_ID,
    requireConnected: false
  });

  if (!connection?.access_token) {
    return null;
  }

  const expiresAt = connection.expires_at
    ? new Date(connection.expires_at).getTime()
    : 0;
  // Refresh a day early since Meta long-lived tokens last ~60 days and
  // there's no rush the way there is with short-lived tokens.
  const expiresSoon = expiresAt && Date.now() >= expiresAt - 24 * 60 * 60 * 1000;

  if (!expiresSoon) {
    return connection.access_token;
  }

  try {
    const refreshed = await refreshMetaToken(connection.access_token);

    await updatePlatformConnection({
      workspaceId: workspace.id,
      connectionId: connection.id,
      updates: {
        access_token: refreshed.accessToken,
        expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
      }
    });

    return refreshed.accessToken;
  } catch {
    // Refresh failed — fall back to existing token, Graph API will 401 if
    // it's actually expired and the caller can surface a reconnect prompt.
    return connection.access_token;
  }
}

// ── Called from app/api/meta/callback/route.js after OAuth ────────────────────
export async function saveMetaConnectionFromOAuth({
  request,
  accessToken,
  expiresIn,
  metadata = {}
}) {
  if (!request) {
    throw new Error(
      "saveMetaConnectionFromOAuth requires a request object to resolve the workspace"
    );
  }

  const expiresAt = expiresIn
    ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
    : null;

  const { workspace, connection } = await upsertPlatformConnection({
    request,
    provider: "meta",
    accountId: DEFAULT_ACCOUNT_ID,
    accountName: "Meta Connection",
    accountCurrency: "USD",
    accessToken,
    refreshToken: "",
    tokenType: "Bearer",
    expiresAt,
    scopes: [],
    metadata
  });

  return {
    saved_to_db: Boolean(connection?.id),
    workspace_id: workspace?.id,
    connection
  };
}
