import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// OAuth Authorization Endpoint (RFC 6749 / RFC 7636)
//
// This endpoint sits between MCP clients (e.g. Claude.ai) and Supabase's
// /auth/v1/oauth/authorize. The key behaviour: we forward the request to
// Supabase WITH the authenticated user's Bearer token so Supabase creates
// the authorization record with user_id populated. Without this, Supabase
// creates the record with user_id=null and later rejects the consent POST
// with "authorization belongs to different user".
//
// Flow:
//  1. Claude.ai → GET /authorize?response_type=code&...
//  2. If user not logged in → redirect to /login?next=/authorize?...
//  3. If logged in → GET supabase /auth/v1/oauth/authorize (with Bearer token)
//     → Supabase returns 302 to our /oauth/consent?authorization_id=...
//  4. User approves on /oauth/consent
//  5. We POST /auth/v1/oauth/authorizations/{id}/consent (with Bearer token)
//     → Supabase returns redirect_url (back to Claude.ai with code)

const SUPABASE_URL = "https://wegbjbrhygqqtczmqvoy.supabase.co";

const ALLOWED_PARAMS = new Set([
  "response_type", "client_id", "redirect_uri", "scope", "state",
  "code_challenge", "code_challenge_method", "resource"
]);

export async function GET(request) {
  const url = new URL(request.url);

  // Validate required OAuth params
  if (
    url.searchParams.has("request_uri") ||
    [...url.searchParams.keys()].some((k) => !ALLOWED_PARAMS.has(k)) ||
    url.searchParams.get("response_type") !== "code" ||
    !url.searchParams.get("client_id") ||
    !url.searchParams.get("redirect_uri") ||
    url.searchParams.get("code_challenge_method") !== "S256" ||
    !url.searchParams.get("code_challenge")
  ) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Check if the user is already logged in via our session cookies.
  const cookieStore = cookies();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let accessToken =
    cookieStore.get("sb-access-token")?.value ||
    cookieStore.get("supabase-access-token")?.value ||
    "";
  const refreshToken = cookieStore.get("sb-refresh-token")?.value || "";

  // Try refreshing if we have both tokens.
  if (accessToken && refreshToken && supabaseAnonKey) {
    try {
      const tempClient = createClient(SUPABASE_URL, supabaseAnonKey, {
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

  // If not logged in, redirect to login first, then come back here.
  if (!accessToken) {
    const selfUrl =
      "https://www.metricsflo.com/authorize?" + url.searchParams.toString();
    const loginUrl =
      "https://www.metricsflo.com/login?next=" + encodeURIComponent(selfUrl);
    return NextResponse.redirect(loginUrl, {
      status: 302,
      headers: { "Cache-Control": "no-store" }
    });
  }

  // Forward to Supabase's authorize endpoint with the user's Bearer token.
  // This causes Supabase to associate user_id with the authorization record,
  // which is required for the consent POST to succeed.
  const target = new URL("/auth/v1/oauth/authorize", SUPABASE_URL);
  target.search = url.searchParams.toString();

  let supabaseRes;
  try {
    supabaseRes = await fetch(target.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey || "",
        "Cache-Control": "no-store"
      },
      redirect: "manual" // We need to intercept the redirect, not follow it
    });
  } catch {
    return NextResponse.json(
      { error: "authorization_server_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Supabase should respond with 302 → /oauth/consent?authorization_id=...
  // We relay that redirect back to the client.
  if (supabaseRes.status === 302 || supabaseRes.status === 301 || supabaseRes.status === 303) {
    const location = supabaseRes.headers.get("location");
    if (!location) {
      return NextResponse.json(
        { error: "invalid_authorization_response" },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Rewrite Supabase's redirect to point at our www.metricsflo.com consent page
    // (Supabase may have been configured with a different consent URL).
    // If the location already points at metricsflo.com, relay it as-is.
    // If it points at Supabase's own consent UI, rewrite to ours.
    let finalLocation = location;
    try {
      const loc = new URL(location, SUPABASE_URL);
      // Supabase redirects to its own host for consent — rewrite to ours.
      if (loc.hostname.includes("supabase.co") || loc.hostname.includes("supabase.com")) {
        // Extract authorization_id and build our consent URL.
        const authId = loc.searchParams.get("authorization_id") || loc.pathname.split("/").pop();
        if (authId) {
          finalLocation =
            "https://www.metricsflo.com/oauth/consent?authorization_id=" +
            encodeURIComponent(authId);
        }
      }
      // If it already points at metricsflo.com or www.metricsflo.com, leave it.
    } catch {
      // Not a parseable URL — relay as-is.
    }

    return NextResponse.redirect(finalLocation, {
      status: 302,
      headers: { "Cache-Control": "no-store" }
    });
  }

  // Unexpected response from Supabase.
  return NextResponse.json(
    { error: "authorization_failed", status: supabaseRes.status },
    { status: 502, headers: { "Cache-Control": "no-store" } }
  );
}
