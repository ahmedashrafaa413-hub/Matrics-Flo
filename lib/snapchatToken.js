import { cookies } from "next/headers";
import {
  getPlatformConnection,
  updatePlatformConnection,
  upsertPlatformConnection
} from "./platformConnections";

const TOKEN_COOKIE = "snapchat_token";
const REFRESH_COOKIE = "snapchat_refresh_token";
const EXPIRY_COOKIE = "snapchat_token_expiry";

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge
  };
}

function getCookieFallbackToken() {
  const cookieStore = cookies();

  return {
    accessToken: cookieStore.get(TOKEN_COOKIE)?.value || "",
    refreshToken: cookieStore.get(REFRESH_COOKIE)?.value || "",
    expiry: Number(cookieStore.get(EXPIRY_COOKIE)?.value || 0)
  };
}

function saveCookieFallbackToken({ accessToken, refreshToken, expiresIn }) {
  const cookieStore = cookies();
  const safeExpiresIn = Number(expiresIn || 3600);
  const expiryTime = Date.now() + safeExpiresIn * 1000;

  if (accessToken) {
    cookieStore.set(
      TOKEN_COOKIE,
      accessToken,
      cookieOptions(safeExpiresIn)
    );

    cookieStore.set(
      EXPIRY_COOKIE,
      String(expiryTime),
      cookieOptions(safeExpiresIn + 60)
    );
  }

  if (refreshToken) {
    cookieStore.set(
      REFRESH_COOKIE,
      refreshToken,
      cookieOptions(60 * 60 * 24 * 180)
    );
  }

  return expiryTime;
}

export function getSnapchatAuthHeader() {
  const clientId = getRequiredEnv("SNAPCHAT_CLIENT_ID");
  const clientSecret = getRequiredEnv("SNAPCHAT_CLIENT_SECRET");

  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  )}`;
}

export async function refreshSnapchatToken(refreshToken, connectionId = "") {
  if (!refreshToken) {
    throw new Error("Missing Snapchat refresh token");
  }

  const response = await fetch(
    "https://accounts.snapchat.com/accounts/oauth2/token",
    {
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
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Snapchat refresh did not return JSON: ${text.slice(0, 120)}`
    );
  }

  if (!response.ok || !data.access_token) {
    throw new Error(
      data?.error_description ||
        data?.error ||
        "Snapchat token refresh failed"
    );
  }

  const expiresIn = Number(data.expires_in || 3600);
  const expiresAtDate = new Date(Date.now() + expiresIn * 1000);

  saveCookieFallbackToken({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn
  });

  if (connectionId) {
    await updatePlatformConnection(connectionId, {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_at: expiresAtDate.toISOString(),
      token_type: data.token_type || "Bearer"
    });
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: expiresAtDate.toISOString(),
    expiresIn,
    raw: data
  };
}

export async function getSnapchatToken(request, accountId = "") {
  try {
    const { connection } = await getPlatformConnection({
      request,
      provider: "snapchat",
      accountId,
      requireConnected: false
    });

    if (connection?.access_token) {
      const expiresAt = connection.expires_at
        ? new Date(connection.expires_at).getTime()
        : 0;

      const expiresSoon =
        !expiresAt || Date.now() >= expiresAt - 5 * 60 * 1000;

      if (!expiresSoon) {
        return connection.access_token;
      }

      if (connection.refresh_token) {
        const refreshed = await refreshSnapchatToken(
          connection.refresh_token,
          connection.id
        );

        return refreshed.accessToken;
      }

      return connection.access_token;
    }
  } catch {
    // Fallback to old cookie storage during migration
  }

  const fallback = getCookieFallbackToken();

  if (!fallback.accessToken && !fallback.refreshToken) {
    return null;
  }

  const expiresSoon =
    !fallback.expiry || Date.now() >= fallback.expiry - 5 * 60 * 1000;

  if (fallback.accessToken && !expiresSoon) {
    return fallback.accessToken;
  }

  if (fallback.refreshToken) {
    const refreshed = await refreshSnapchatToken(fallback.refreshToken);
    return refreshed.accessToken;
  }

  return fallback.accessToken || null;
}

export async function saveSnapchatConnectionFromOAuth({
  request,
  accessToken,
  refreshToken,
  expiresIn,
  tokenType = "Bearer",
  scopes = [],
  metadata = {}
}) {
  const expiresAt = new Date(Date.now() + Number(expiresIn || 3600) * 1000);

  saveCookieFallbackToken({
    accessToken,
    refreshToken,
    expiresIn
  });

  return upsertPlatformConnection({
    request,
    provider: "snapchat",
    accountId: "snapchat_default",
    accountName: "Snapchat Connection",
    accountCurrency: "USD",
    accessToken,
    refreshToken,
    tokenType,
    expiresAt: expiresAt.toISOString(),
    scopes,
    metadata
  });
}
