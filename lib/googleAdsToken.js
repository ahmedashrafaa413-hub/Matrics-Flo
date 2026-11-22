// lib/googleAdsToken.js
// Workspace-scoped Google Ads OAuth token, stored in platform_connections as
// provider="google_ads", account_id="google_ads_default" (same pattern as
// GA4). Ad accounts are discovered live from the Google Ads API on each call,
// so accounts added to the Google login later show up without reconnecting.

import { refreshGoogleToken } from "./gaToken";
import { getAppUrl } from "./oauthFoundation.mjs";
import {
  getPlatformConnection,
  getPlatformConnectionForWorkspace,
  upsertPlatformConnection,
  updatePlatformConnection
} from "./platformConnections";

export const GOOGLE_ADS_PROVIDER = "google_ads";
const DEFAULT_ACCOUNT_ID = "google_ads_default";

// Same Google OAuth client as GA4, with its own redirect URI
// (GOOGLE_ADS_REDIRECT_URI, default <app>/api/google-ads/callback), which
// must be listed under Authorized redirect URIs in Google Cloud.
export function googleAdsRedirectUri(request) {
  return process.env.GOOGLE_ADS_REDIRECT_URI || `${getAppUrl(request)}/api/google-ads/callback`;
}

export function getGoogleAdsDeveloperToken() {
  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!token) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is not configured");
  return token;
}

// Optional: a manager (MCC) account ID to read every client account through.
export function getGoogleAdsLoginCustomerId() {
  return process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "";
}

async function ensureFreshToken(workspaceId, connection) {
  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (connection.access_token && expiresAt && Date.now() < expiresAt - 60 * 1000) return connection;

  const refreshed = await refreshGoogleToken(connection.refresh_token);
  return updatePlatformConnection({
    workspaceId,
    connectionId: connection.id,
    updates: {
      access_token: refreshed.accessToken,
      expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
    }
  });
}

// For the MCP server (explicit, already-authorized workspace).
// Returns { connection } with a fresh access token, or { connection: null }.
export async function getGoogleAdsConnectionForWorkspace(workspaceId) {
  const connection = await getPlatformConnectionForWorkspace({
    workspaceId,
    provider: GOOGLE_ADS_PROVIDER,
    accountId: DEFAULT_ACCOUNT_ID,
    requireConnected: false
  });
  if (!connection?.refresh_token) return { connection: null };
  return { connection: await ensureFreshToken(workspaceId, connection) };
}

// Called from app/api/google-ads/callback after OAuth.
export async function saveGoogleAdsConnectionFromOAuth({ request, accessToken, refreshToken, expiresIn, scopes = [], metadata = {} }) {
  // Google only sends a refresh token on first consent; keep the old one.
  if (!refreshToken) {
    try {
      const { connection: previous } = await getPlatformConnection({
        request,
        provider: GOOGLE_ADS_PROVIDER,
        accountId: DEFAULT_ACCOUNT_ID,
        requireConnected: false
      });
      refreshToken = previous?.refresh_token || "";
    } catch {
      refreshToken = "";
    }
  }

  const { workspace, connection } = await upsertPlatformConnection({
    request,
    provider: GOOGLE_ADS_PROVIDER,
    accountId: DEFAULT_ACCOUNT_ID,
    accountName: "Google Ads",
    accountCurrency: "SAR",
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + Number(expiresIn || 3600) * 1000).toISOString(),
    scopes,
    metadata
  });

  return { saved_to_db: Boolean(connection?.id), has_refresh_token: Boolean(refreshToken), workspace_id: workspace?.id };
}
