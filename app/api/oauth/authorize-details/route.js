import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/serverAuth";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private" }
  });
}

export async function GET(request) {
  // 1. Validate authorization_id param
  const { searchParams } = new URL(request.url);
  const authorizationId = searchParams.get("authorization_id");
  if (!authorizationId || authorizationId.length > 256) {
    return json({ error: "Missing or invalid authorization_id" }, 400);
  }

  // 2. Resolve a valid (non-expired) access token.
  //    getServerAccessToken reads the cookie but may return an expired JWT.
  //    We attempt to refresh via getCurrentUser (which calls refreshSession internally
  //    and writes the new token to the response cookies), then fall back to whatever
  //    token is in the cookies if no refresh was needed.
  const { cookies } = await import("next/headers");
  const cookieStore = cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return json({ error: "supabase_not_configured" }, 503);
  }

  // Try to get a fresh token: use refresh_token to mint a new access_token.
  const refreshToken =
    cookieStore.get("sb-refresh-token")?.value || "";
  let accessToken =
    cookieStore.get("sb-access-token")?.value ||
    cookieStore.get("supabase-access-token")?.value ||
    "";

  if (refreshToken && accessToken) {
    // Silently attempt a token refresh to ensure the JWT isn't expired.
    try {
      const tempClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const { data: refreshData } = await tempClient.auth.refreshSession({
        refresh_token: refreshToken
      });
      if (refreshData?.session?.access_token) {
        accessToken = refreshData.session.access_token;
      }
    } catch {
      // refreshSession failed — continue with existing token
    }
  }

  if (!accessToken) return json({ error: "login_required" }, 401);

  // Verify the token belongs to a real user (any authenticated user allowed).
  try {
    const { user } = await getCurrentUser(request);
    if (!user) return json({ error: "login_required" }, 401);
  } catch {
    return json({ error: "authentication_unavailable" }, 503);
  }

  // Call Supabase Auth REST API directly — the supabase-js SDK does not expose
  // the OAuth server endpoints (auth.oauth is not part of the public SDK).
  const authApiUrl = `${supabaseUrl}/auth/v1/oauth/authorize-details?authorization_id=${encodeURIComponent(authorizationId)}`;

  let authRes;
  try {
    authRes = await fetch(authApiUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "apikey": supabaseAnonKey,
        "Content-Type": "application/json"
      }
    });
  } catch (fetchErr) {
    return json({ error: "Failed to reach Supabase Auth API" }, 503);
  }

  let authData;
  try {
    authData = await authRes.json();
  } catch {
    return json({ error: "Invalid response from Supabase Auth API" }, 502);
  }

  if (!authRes.ok) {
    const errMsg = authData?.msg || authData?.error || authData?.message || "authorization_lookup_failed";
    return json({ error: errMsg }, authRes.status >= 500 ? 502 : 400);
  }

  return json({ data: authData });
}
