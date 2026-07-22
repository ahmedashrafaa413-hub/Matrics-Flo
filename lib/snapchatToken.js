// lib/snapchatToken.js
// ─────────────────────────────────────────────────────────────────────────────
// Workspace-scoped Snapchat token storage.
//
// Tokens live in the `platform_connections` table (provider="snapchat",
// account_id="snapchat_default"), keyed by workspace_id. This makes the
// Snapchat connection follow the WORKSPACE, not the browser — any user who
// belongs to that workspace, from any device/browser/login, sees the same
// connection. This replaces the old cookie-only implementation, which tied
// the connection to a single browser and broke multi-user / multi-store use.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getPlatformConnection,
  upsertPlatformConnection,
  updatePlatformConnection
} from "./platformConnections";

const DEFAULT_ACCOUNT_ID = "snapchat_default";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getSnapchatAuthHeader() {
  const clientId = getRequiredEnv("SNAPCHAT_CLIENT_ID");
  const clientSecret = getRequiredEnv("SNAPCHAT_CLIENT_SECRET");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export async function refreshSnapchatToken(refreshToken) {
  if (!refreshToken) throw new Error("Missing Snapchat refresh token");

  const res = await fetch("https://accounts.snapchat.com/accounts/oauth2/token", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: getSnapchatAuthHeader()
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  const text = await res.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Snapchat refresh did not return JSON: ${text.slice(0, 120)}`);
  }

  if (!res.ok || !data.access_token) {
    throw new Error(data?.error_description || data?.error || "Snapchat token refresh failed");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: Number(data.expires_in || 3600)
  };
}

// ── Main export — called throughout the codebase ──────────────────────────────
// Signature: getSnapchatToken(request) — request is required to resolve the
// active workspace. Any extra arguments (e.g. an accountId some call sites
// still pass) are accepted but ignored: the Snapchat OAuth token is
// account-agnostic within an organization, so one workspace-level token
// covers every Snapchat ad account connected to that workspace.
export async function getSnapchatToken(request) {
  if (!request) {
    throw new Error(
      "getSnapchatToken(request) requires a request object to resolve the workspace"
    );
  }

  const { workspace, connection } = await getPlatformConnection({
    request,
    provider: "snapchat",
    accountId: DEFAULT_ACCOUNT_ID,
    requireConnected: false
  });

  if (!connection?.access_token && !connection?.refresh_token) {
    return null;
  }

  const expiresAt = connection.expires_at
    ? new Date(connection.expires_at).getTime()
    : 0;
  const expiresSoon = !expiresAt || Date.now() >= expiresAt - 5 * 60 * 1000;

  if (connection.access_token && !expiresSoon) {
    return connection.access_token;
  }

  if (connection.refresh_token) {
    try {
      const refreshed = await refreshSnapchatToken(connection.refresh_token);

      await updatePlatformConnection({
        workspaceId: workspace.id,
        connectionId: connection.id,
        updates: {
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
          expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
        }
      });

      return refreshed.accessToken;
    } catch {
      // Refresh failed — fall back to existing token if still present
      return connection.access_token || null;
    }
  }

  return connection.access_token || null;
}

// ── Called from app/api/snapchat/callback/route.js after OAuth ────────────────
export async function saveSnapchatConnectionFromOAuth({
  request,
  accessToken,
  refreshToken,
  expiresIn,
  tokenType = "Bearer",
  scopes = [],
  metadata = {}
}) {
  if (!request) {
    throw new Error(
      "saveSnapchatConnectionFromOAuth requires a request object to resolve the workspace"
    );
  }

  const expiresAt = new Date(
    Date.now() + Number(expiresIn || 3600) * 1000
  ).toISOString();

  const { workspace, connection } = await upsertPlatformConnection({
    request,
    provider: "snapchat",
    accountId: DEFAULT_ACCOUNT_ID,
    accountName: "Snapchat Connection",
    accountCurrency: "USD",
    accessToken,
    refreshToken,
    tokenType,
    expiresAt,
    scopes,
    metadata
  });

  return {
    saved_to_db: Boolean(connection?.id),
    workspace_id: workspace?.id,
    connection
  };
}
