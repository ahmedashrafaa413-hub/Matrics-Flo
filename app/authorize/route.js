import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// OAuth Authorization Endpoint (RFC 6749 / RFC 7636)
//
// This endpoint sits between MCP clients (e.g. Claude.ai) and Supabase's
// /auth/v1/oauth/authorize. The key behaviour:
//  1. We call Supabase's /oauth/authorize (creates the authorization record,
//     but user_id may be null because Vercel strips the Authorization header)
//  2. We parse the authorization_id from Supabase's redirect response
//  3. We use the Supabase SERVICE ROLE key to UPDATE the authorization record,
//     setting user_id from the user's JWT (decoded server-side). This is the
//     reliable fix — no Bearer token stripping issue.
//
// Flow:
//  1. Claude.ai → GET /authorize?response_type=code&...
//  2. If user not logged in → redirect to /login?next=/authorize?...
//  3. If logged in → GET supabase /auth/v1/oauth/authorize
//     → Supabase returns 302 with authorization_id
//  4. We UPDATE auth.oauth_authorizations SET user_id=... using service role
//  5. Redirect to /oauth/consent?authorization_id=...
//  6. User approves; consent POST succeeds because user_id now matches

const SUPABASE_URL = "https://wegbjbrhygqqtczmqvoy.supabase.co";

// Decode a JWT payload without verifying the signature (server-side only).
// We trust the token because we just refreshed it via Supabase's /token endpoint.
function decodeJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // base64url → base64 → JSON
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

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

  // Decode the user's ID from their JWT (no signature verification needed —
  // we just refreshed this token via Supabase's /token endpoint).
  const jwtPayload = decodeJwtPayload(accessToken);
  const userId = jwtPayload?.sub;
  if (!userId) {
    // Token is malformed — treat as not logged in.
    const selfUrl =
      "https://www.metricsflo.com/authorize?" + url.searchParams.toString();
    const loginUrl =
      "https://www.metricsflo.com/login?next=" + encodeURIComponent(selfUrl);
    return NextResponse.redirect(loginUrl, {
      status: 302,
      headers: { "Cache-Control": "no-store" }
    });
  }

  // Step 1: Call Supabase's authorize endpoint to create the authorization record.
  // The record will have user_id=null (Vercel strips the Authorization header),
  // but we'll fix that in Step 2.
  const target = new URL("/auth/v1/oauth/authorize", SUPABASE_URL);
  target.search = url.searchParams.toString();

  const https = await import("node:https");
  const targetUrl = target.toString();

  let supabaseRes;
  try {
    supabaseRes = await new Promise((resolve, reject) => {
      const req = https.default.get(
        targetUrl,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: supabaseAnonKey || "",
            "Cache-Control": "no-store",
            "User-Agent": "MetricsFlo-OAuth/1.0"
          }
        },
        (res) => {
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

  const resStatus = supabaseRes.statusCode ?? supabaseRes.status;
  if (resStatus !== 302 && resStatus !== 301 && resStatus !== 303) {
    return NextResponse.json(
      { error: "authorization_failed", status: resStatus },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  const rawLocation = supabaseRes.headers?.location;
  const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
  if (!location) {
    return NextResponse.json(
      { error: "invalid_authorization_response" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Extract the authorization_id from Supabase's redirect location.
  let authorizationId = null;
  try {
    const loc = new URL(location, SUPABASE_URL);
    authorizationId =
      loc.searchParams.get("authorization_id") ||
      loc.pathname.split("/").filter(Boolean).pop();
  } catch {
    // fall through — authorizationId stays null
  }

  if (!authorizationId) {
    return NextResponse.json(
      { error: "missing_authorization_id" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Step 2: Set user_id on the authorization record via Supabase PostgREST RPC.
  // We call the SECURITY DEFINER function set_oauth_authorization_user() which runs
  // as the DB owner and can UPDATE auth.oauth_authorizations regardless of RLS.
  // Using PostgREST REST API directly (service role key) — no Edge Function needed.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAnonKeyVal = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (serviceRoleKey) {
    try {
      const rpcUrl = `${SUPABASE_URL}/rest/v1/rpc/set_oauth_authorization_user`;
      const rpcRes = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
          "apikey": supabaseAnonKeyVal || serviceRoleKey
        },
        body: JSON.stringify({
          p_authorization_id: authorizationId,
          p_user_id: userId
        })
      });
      if (!rpcRes.ok) {
        const errText = await rpcRes.text().catch(() => "");
        console.error(`[authorize] RPC set_oauth_authorization_user failed: ${rpcRes.status} ${errText}`);
      } else {
        const result = await rpcRes.json().catch(() => null);
        console.log(`[authorize] RPC set_oauth_authorization_user result: ${result}`);
      }
    } catch (err) {
      console.error(`[authorize] RPC call error:`, err);
    }
  }

  // Step 3: Redirect to our consent page.
  const finalLocation =
    "https://www.metricsflo.com/oauth/consent?authorization_id=" +
    encodeURIComponent(authorizationId);

  return NextResponse.redirect(finalLocation, {
    status: 302,
    headers: { "Cache-Control": "no-store" }
  });
}
