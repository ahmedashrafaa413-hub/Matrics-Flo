// lib/gaToken.js
// ─────────────────────────────────────────────────────────────────────────────
// Workspace-scoped Google Analytics 4 token storage.
//
// Tokens live in the `platform_connections` table (provider="ga4",
// account_id="ga4_default"), keyed by workspace_id — same pattern as
// Meta/Snapchat/Salla. Previously GA4 tokens were saved to a separate
// `ga_connections` table under a hardcoded user_id of "default_user" shared
// by every workspace on the platform, which meant every workspace saw the
// same GA4 property's traffic.
//
// The selected GA4 property is stored in `metadata.property_id` /
// `metadata.property_name` rather than as the connection's account_id, so
// switching properties updates the existing connection instead of creating
// a new one.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getPlatformConnection,
  upsertPlatformConnection,
  updatePlatformConnection
} from "./platformConnections";

const DEFAULT_ACCOUNT_ID = "ga4_default";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export async function refreshGoogleToken(refreshToken) {
  if (!refreshToken) throw new Error("Missing Google refresh token");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: getRequiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: getRequiredEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    throw new Error(
      data?.error_description || data?.error || "Google token refresh failed"
    );
  }

  return {
    accessToken: data.access_token,
    expiresIn: Number(data.expires_in || 3600)
  };
}

// ── Main export — call as getGaConnection(request) from any route ─────────────
// Returns { user, workspace, connection, propertyId, propertyName } where
// connection is null if GA4 isn't connected for the workspace yet. Refreshes
// the access token in place when it's missing or about to expire (Google
// access tokens are always short-lived, unlike Meta/Snapchat).
export async function getGaConnection(request) {
  const { user, workspace, connection } = await getPlatformConnection({
    request,
    provider: "ga4",
    accountId: DEFAULT_ACCOUNT_ID,
    requireConnected: false
  });

  if (!connection?.refresh_token) {
    return { user, workspace, connection: null, propertyId: null, propertyName: null };
  }

  const propertyId = connection.metadata?.property_id || null;
  const propertyName = connection.metadata?.property_name || null;

  const expiresAt = connection.expires_at
    ? new Date(connection.expires_at).getTime()
    : 0;
  const expiresSoon = !expiresAt || Date.now() >= expiresAt - 60 * 1000;

  if (connection.access_token && !expiresSoon) {
    return { user, workspace, connection, propertyId, propertyName };
  }

  const refreshed = await refreshGoogleToken(connection.refresh_token);

  const updated = await updatePlatformConnection(connection.id, {
    access_token: refreshed.accessToken,
    expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
  });

  return { user, workspace, connection: updated, propertyId, propertyName };
}

// ── Called from app/api/ga/callback/route.js after OAuth ──────────────────────
export async function saveGaConnectionFromOAuth({
  request,
  accessToken,
  refreshToken,
  expiresIn,
  propertyId,
  propertyName,
  metadata = {}
}) {
  const expiresAt = new Date(
    Date.now() + Number(expiresIn || 3600) * 1000
  ).toISOString();

  const { workspace, connection } = await upsertPlatformConnection({
    request,
    provider: "ga4",
    accountId: DEFAULT_ACCOUNT_ID,
    accountName: propertyName || "Google Analytics",
    accountCurrency: "SAR",
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresAt,
    scopes: [],
    metadata: {
      ...metadata,
      property_id: propertyId || null,
      property_name: propertyName || null
    }
  });

  return {
    saved_to_db: Boolean(connection?.id),
    workspace_id: workspace?.id,
    connection
  };
}

// ── Called from app/api/ga/select-property/route.js ────────────────────────────
export async function updateGaSelectedProperty(request, { propertyId, propertyName }) {
  const { connection } = await getPlatformConnection({
    request,
    provider: "ga4",
    accountId: DEFAULT_ACCOUNT_ID,
    requireConnected: true
  });

  const updated = await updatePlatformConnection(connection.id, {
    account_name: propertyName || connection.account_name,
    metadata: {
      ...(connection.metadata || {}),
      property_id: propertyId,
      property_name: propertyName
    }
  });

  return updated;
}
