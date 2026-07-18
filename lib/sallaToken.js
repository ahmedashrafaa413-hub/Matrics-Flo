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
  getPlatformConnection,
  upsertPlatformConnection,
  updatePlatformConnection
} from "./platformConnections";

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
    throw new Error(
      data?.error_description || data?.error || "Salla token refresh failed"
    );
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

  if (!connection?.access_token && !connection?.refresh_token) {
    return { user, workspace, connection: null };
  }

  const expiresAt = connection.expires_at
    ? new Date(connection.expires_at).getTime()
    : 0;
  const expiresSoon = !expiresAt || Date.now() >= expiresAt - 5 * 60 * 1000;

  if (connection.access_token && !expiresSoon) {
    return { user, workspace, connection };
  }

  if (connection.refresh_token) {
    try {
      const refreshed = await refreshSallaToken(connection.refresh_token);

      const updated = await updatePlatformConnection(connection.id, {
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken,
        expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
      });

      return { user, workspace, connection: updated };
    } catch {
      // Refresh failed — fall back to the existing connection, Salla will
      // 401 if it's actually expired and the caller can surface a reconnect.
      return { user, workspace, connection };
    }
  }

  return { user, workspace, connection };
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
