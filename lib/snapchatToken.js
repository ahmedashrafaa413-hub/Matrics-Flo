// lib/snapchatToken.js
// ─────────────────────────────────────────────────────────────────────────────
// Cookie-based Snapchat token storage.
// This is the ACTIVE system for MetricsFlo production.
//
// The workspace/platform_connections multi-tenant system exists in the DB
// but is NOT yet wired to any routes. When that migration is completed
// deliberately, this file will be replaced. Until then, cookies are the
// single source of truth for Snapchat auth tokens.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from "next/headers";

const TOKEN_COOKIE   = "snapchat_token";
const REFRESH_COOKIE = "snapchat_refresh_token";
const EXPIRY_COOKIE  = "snapchat_token_expiry";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge,
  };
}

export function getSnapchatAuthHeader() {
  const clientId     = getRequiredEnv("SNAPCHAT_CLIENT_ID");
  const clientSecret = getRequiredEnv("SNAPCHAT_CLIENT_SECRET");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function readCookies() {
  const cookieStore = cookies();
  return {
    accessToken:  cookieStore.get(TOKEN_COOKIE)?.value   || "",
    refreshToken: cookieStore.get(REFRESH_COOKIE)?.value || "",
    expiry:       Number(cookieStore.get(EXPIRY_COOKIE)?.value || 0),
  };
}

function writeCookies({ accessToken, refreshToken, expiresIn }) {
  const cookieStore  = cookies();
  const safeExpiry   = Number(expiresIn || 3600);
  const expiryTime   = Date.now() + safeExpiry * 1000;

  if (accessToken) {
    cookieStore.set(TOKEN_COOKIE,   accessToken, cookieOptions(safeExpiry));
    cookieStore.set(EXPIRY_COOKIE,  String(expiryTime), cookieOptions(safeExpiry + 60));
  }
  if (refreshToken) {
    cookieStore.set(REFRESH_COOKIE, refreshToken, cookieOptions(60 * 60 * 24 * 180));
  }
  return expiryTime;
}

export async function refreshSnapchatToken(refreshToken) {
  if (!refreshToken) throw new Error("Missing Snapchat refresh token");

  const res  = await fetch("https://accounts.snapchat.com/accounts/oauth2/token", {
    method:  "POST",
    cache:   "no-store",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:  getSnapchatAuthHeader(),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });

  const text = await res.text();
  let data;
  try   { data = JSON.parse(text); }
  catch { throw new Error(`Snapchat refresh did not return JSON: ${text.slice(0, 120)}`); }

  if (!res.ok || !data.access_token) {
    throw new Error(data?.error_description || data?.error || "Snapchat token refresh failed");
  }

  const expiresIn = Number(data.expires_in || 3600);
  writeCookies({ accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken, expiresIn });

  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn,
  };
}

// ── Main export — called throughout the codebase ──────────────────────────────
// Signature: getSnapchatToken() — no parameters needed.
// Reads from cookies, auto-refreshes if expiring soon.
export async function getSnapchatToken() {
  const { accessToken, refreshToken, expiry } = readCookies();

  if (!accessToken && !refreshToken) return null;

  const expiresSoon = !expiry || Date.now() >= expiry - 5 * 60 * 1000;

  if (accessToken && !expiresSoon) return accessToken;

  if (refreshToken) {
    try {
      const refreshed = await refreshSnapchatToken(refreshToken);
      return refreshed.accessToken;
    } catch {
      // Refresh failed — return existing token if still present
      return accessToken || null;
    }
  }

  return accessToken || null;
}

// ── Called from app/api/snapchat/callback/route.js after OAuth ────────────────
export async function saveSnapchatConnectionFromOAuth({
  accessToken,
  refreshToken,
  expiresIn,
}) {
  writeCookies({ accessToken, refreshToken, expiresIn });
}
