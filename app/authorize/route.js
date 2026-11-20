import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  // Try refreshing — if we have a refresh token, use it (even without an
  // existing access token) to get a fresh token and confirm the user is
  // logged in. If we have both, prefer the refresh to get a non-expired token.
  if (refreshToken && supabaseAnonKey) {
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
      // refreshSession failed — continue with existing token (or empty)
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

  // Use Node.js https module directly to avoid any proxy/fetch layer stripping
  // the Authorization header before it reaches Supabase.
  const https = await import("node:https");
  const targetUrl = target.toString();
  const authHeader = `Bearer ${accessToken}`;
  const apikeyHeader = supabaseAnonKey || "";

  let supabaseRes;
  try {
    supabaseRes = await new Promise((resolve, reject) => {
      const req = https.default.get(
        targetUrl,
        {
          headers: {
            Authorization: authHeader,
            apikey: apikeyHeader,
            "Cache-Control": "no-store",
            "User-Agent": "MetricsFlo-OAuth/1.0"
          }
        },
        (res) => {
          // Drain response body to free socket
          res.resume();
          resolve(res);
        }
      );
      req.on("error", reject);
      req.setTimeout(10000, () => { req.destroy(new Error("timeout")); });
    });
  } catch {
    return NextResponse.json(
      { error: "authorization_server_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Supabase should respond with 302 → /oauth/consent?authorization_id=...
  // We relay that redirect back to the client.
  // Note: https.get response uses .statusCode and .headers[name] (lowercase, array or string).
  const resStatus = supabaseRes.statusCode ?? supabaseRes.status;
  if (resStatus === 302 || resStatus === 301 || resStatus === 303) {
    const rawLocation = supabaseRes.headers?.location;
    const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
    if (!location) {
      return NextResponse.json(
        { error: "invalid_authorization_response" },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Rewrite Supabase's redirect to always point at www.metricsflo.com consent page.
    // Supabase may redirect to: its own host, bare metricsflo.com, or www.metricsflo.com.
    // Session cookies are scoped to .metricsflo.com so both bare and www work for cookies,
    // but bare metricsflo.com may not serve Next.js routes — always rewrite to www.
    let finalLocation = location;
    try {
      const loc = new URL(location, SUPABASE_URL);
      const h = loc.hostname;
      if (h.includes("supabase.co") || h.includes("supabase.com")) {
        // Supabase's own consent UI — extract authorization_id and build our consent URL.
        const authId = loc.searchParams.get("authorization_id") || loc.pathname.split("/").pop();
        if (authId) {
          finalLocation =
            "https://www.metricsflo.com/oauth/consent?authorization_id=" +
            encodeURIComponent(authId);
        }
      } else if (h === "metricsflo.com") {
        // Bare domain — rewrite to www so session cookies and Next.js routes work.
        loc.hostname = "www.metricsflo.com";
        finalLocation = loc.toString();
      }
      // www.metricsflo.com already — leave it as-is.
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
    { error: "authorization_failed", status: resStatus },
    { status: 502, headers: { "Cache-Control": "no-store" } }
  );
}
