// lib/sallaToken.js
// ─────────────────────────────────────────────────────────────────────────────
// Workspace-scoped Salla token storage.
//
// Tokens live in the `platform_connections` table (provider="salla",
// account_id="salla_default"), keyed by workspace_id — same pattern as
// Meta/Snapchat. Previously Salla tokens were saved to a separate
// `salla_connections` table under a hardcoded user_id of "default_user"
// shared by every workspace on the platform, which meant every workspace
// saw the same store's orders.
// ─────────────────────────────────────────────────────────────────────────────

import {
  connectionExpiresWithin,
  getPlatformConnection,
  getPlatformConnectionForWorkspace,
  refreshConnectionToken,
  upsertPlatformConnection
} from "./platformConnections";

const REFRESH_SKEW_MS = 5 * 60 * 1000;

async function resolveSallaConnection(workspaceId, connection) {
  if (!connection?.access_token && !connection?.refresh_token) return null;

  if (connection.access_token && !connectionExpiresWithin(connection, REFRESH_SKEW_MS)) {
    return connection;
  }

  if (!connection.refresh_token) return connection;

  // Salla refresh tokens are single-use: refreshConnectionToken makes sure
  // only one request spends it.
  return refreshConnectionToken({
    workspaceId,
    connection,
    provider: "Salla",
    skewMs: REFRESH_SKEW_MS,
    refresh: async (current) => {
      const result = await refreshSallaToken(current.refresh_token);
      return {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        expires_at: new Date(Date.now() + result.expiresIn * 1000).toISOString()
      };
    }
  });
}

const DEFAULT_ACCOUNT_ID = "salla_default";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export async function refreshSallaToken(refreshToken) {
  if (!refreshToken) throw new Error("Missing Salla refresh token");

  const clientId = getRequiredEnv("SALLA_CLIENT_ID");
  const clientSecret = getRequiredEnv("SALLA_CLIENT_SECRET");

  const res = await fetch("https://accounts.salla.sa/oauth2/token", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    const error = new Error(
      data?.error_description || data?.error || "Salla token refresh failed"
    );
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

// ── Main export — call as getSallaConnection(request) from any route ──────────
// Returns { user, workspace, connection } where connection is null if Salla
// isn't connected for the workspace yet. Refreshes the access token in place
// when it's missing or about to expire.
export async function getSallaConnection(request) {
  const { user, workspace, connection } = await getPlatformConnection({
    request,
    provider: "salla",
    accountId: DEFAULT_ACCOUNT_ID,
    requireConnected: false
  });

  const resolved = await resolveSallaConnection(workspace.id, connection);
  return { user, workspace, connection: resolved };
}

export async function getSallaConnectionForWorkspace(workspaceId) {
  const connection = await getPlatformConnectionForWorkspace({
    workspaceId,
    provider: "salla",
    accountId: DEFAULT_ACCOUNT_ID,
    requireConnected: false
  });

  return resolveSallaConnection(workspaceId, connection);
}

// ── Called from app/api/salla/callback/route.js after OAuth ───────────────────
export async function saveSallaConnectionFromOAuth({
  request,
  accessToken,
  refreshToken,
  expiresIn,
  merchantId,
  storeName,
  metadata = {}
}) {
  const expiresAt = new Date(
    Date.now() + Number(expiresIn || 3600) * 1000
  ).toISOString();

  const { workspace, connection } = await upsertPlatformConnection({
    request,
    provider: "salla",
    accountId: DEFAULT_ACCOUNT_ID,
    accountName: storeName || "Salla Store",
    accountCurrency: "SAR",
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresAt,
    scopes: [],
    metadata: {
      ...metadata,
      merchant_id: merchantId ? String(merchantId) : null,
      store_name: storeName || null
    }
  });

  return {
    saved_to_db: Boolean(connection?.id),
    workspace_id: workspace?.id,
    connection
  };
}
