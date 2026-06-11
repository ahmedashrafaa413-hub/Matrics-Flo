import { cookies } from "next/headers";

const TOKEN_COOKIE   = "snapchat_token";
const REFRESH_COOKIE = "snapchat_refresh_token";
const EXPIRY_COOKIE  = "snapchat_token_expiry";

/**
 * Returns a valid Snapchat access token.
 * Automatically refreshes if expired or about to expire.
 */
export async function getSnapchatToken() {
  const cookieStore = cookies();
  const token       = cookieStore.get(TOKEN_COOKIE)?.value;
  const refreshToken= cookieStore.get(REFRESH_COOKIE)?.value;
  const expiry      = cookieStore.get(EXPIRY_COOKIE)?.value;

  if (!token && !refreshToken) return null;

  // Check if token is expired or expires in less than 5 minutes
  const now        = Date.now();
  const expiryTime = expiry ? parseInt(expiry) : 0;
  const isExpired  = !expiry || now >= expiryTime - 5 * 60 * 1000;

  if (!isExpired && token) return token;

  // Token expired — try to refresh
  if (!refreshToken) return null;

  try {
    const newToken = await refreshSnapchatToken(refreshToken);
    return newToken;
  } catch {
    return null;
  }
}

async function refreshSnapchatToken(refreshToken) {
  const clientId     = process.env.SNAPCHAT_CLIENT_ID;
  const clientSecret = process.env.SNAPCHAT_CLIENT_SECRET;

  const res = await fetch("https://accounts.snapchat.com/accounts/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed");

  // Save new tokens
  const cookieStore = cookies();
  const expiresIn   = data.expires_in || 3600;
  const newExpiry   = Date.now() + expiresIn * 1000;

  const cookieOpts = {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    path:     "/",
  };

  cookieStore.set(TOKEN_COOKIE,   data.access_token, { ...cookieOpts, maxAge: expiresIn });
  cookieStore.set(EXPIRY_COOKIE,  String(newExpiry),  { ...cookieOpts, maxAge: expiresIn + 60 });

  if (data.refresh_token) {
    cookieStore.set(REFRESH_COOKIE, data.refresh_token, { ...cookieOpts, maxAge: 60 * 60 * 24 * 180 }); // 6 months
  }

  return data.access_token;
}
