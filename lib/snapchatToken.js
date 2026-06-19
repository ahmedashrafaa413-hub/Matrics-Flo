import { cookies } from "next/headers";

const TOKEN_COOKIE = "snapchat_token";
const REFRESH_COOKIE = "snapchat_refresh_token";
const EXPIRY_COOKIE = "snapchat_token_expiry";

function getCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge
  };
}

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

export async function getSnapchatToken() {
  const cookieStore = cookies();

  const token = cookieStore.get(TOKEN_COOKIE)?.value || "";
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value || "";
  const expiry = cookieStore.get(EXPIRY_COOKIE)?.value || "";

  if (!token && !refreshToken) {
    return null;
  }

  const now = Date.now();
  const expiryTime = expiry ? Number(expiry) : 0;
  const expiresSoon = !expiryTime || now >= expiryTime - 5 * 60 * 1000;

  if (token && !expiresSoon) {
    return token;
  }

  if (!refreshToken) {
    return token || null;
  }

  return refreshSnapchatToken(refreshToken);
}

export async function refreshSnapchatToken(refreshToken) {
  const clientId = getRequiredEnv("SNAPCHAT_CLIENT_ID");
  const clientSecret = getRequiredEnv("SNAPCHAT_CLIENT_SECRET");

  const response = await fetch(
    "https://accounts.snapchat.com/accounts/oauth2/token",
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${clientId}:${clientSecret}`
        ).toString("base64")}`
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
      data?.error_description || data?.error || "Snapchat token refresh failed"
    );
  }

  const expiresIn = Number(data.expires_in || 3600);
  const expiryTime = Date.now() + expiresIn * 1000;

  const cookieStore = cookies();

  cookieStore.set(TOKEN_COOKIE, data.access_token, getCookieOptions(expiresIn));

  cookieStore.set(
    EXPIRY_COOKIE,
    String(expiryTime),
    getCookieOptions(expiresIn + 60)
  );

  if (data.refresh_token) {
    cookieStore.set(
      REFRESH_COOKIE,
      data.refresh_token,
      getCookieOptions(60 * 60 * 24 * 180)
    );
  }

  return data.access_token;
}
