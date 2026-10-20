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
  connectionExpiresWithin,
  getPlatformConnection,
  getPlatformConnectionForWorkspace,
  refreshConnectionToken,
  upsertPlatformConnection
} from "./platformConnections";

const REFRESH_SKEW_MS = 5 * 60 * 1000;

async function resolveSnapchatAccessToken(workspaceId, connection) {
  if (!connection?.access_token && !connection?.refresh_token) return null;

  if (connection.access_token && !connectionExpiresWithin(connection, REFRESH_SKEW_MS)) {
    return connection.access_token;
  }

  if (!connection.refresh_token) return connection.access_token || null;

  const refreshed = await refreshConnectionToken({
    workspaceId,
    connection,
    provider: "Snapchat",
    skewMs: REFRESH_SKEW_MS,
    refresh: async (current) => {
      const result = await refreshSnapchatToken(current.refresh_token);
      return {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        expires_at: new Date(Date.now() + result.expiresIn * 1000).toISOString()
      };
    }
  });

  return refreshed?.access_token || null;
}

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
    const error = new Error(data?.error_description || data?.error || "Snapchat token refresh failed");
    error.status = res.status;
    error.code = data?.error;
    throw error;
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

  return resolveSnapchatAccessToken(workspace.id, connection);
}

export async function getSnapchatTokenForWorkspace(workspaceId) {
  const connection = await getPlatformConnectionForWorkspace({
    workspaceId,
    provider: "snapchat",
    accountId: DEFAULT_ACCOUNT_ID,
    requireConnected: false
  });

  return resolveSnapchatAccessToken(workspaceId, connection);
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
