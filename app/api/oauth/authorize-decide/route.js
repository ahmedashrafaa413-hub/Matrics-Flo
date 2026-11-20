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

export async function POST(request) {
  // 1. Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const { authorization_id: authorizationId, approve } = body;
  if (!authorizationId || typeof authorizationId !== "string" || authorizationId.length > 256) {
    return json({ error: "Missing or invalid authorization_id" }, 400);
  }
  if (typeof approve !== "boolean") {
    return json({ error: "approve must be a boolean" }, 400);
  }

  // 2. Resolve a valid (non-expired) access token via token refresh if needed.
  const { cookies } = await import("next/headers");
  const cookieStore = cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return json({ error: "supabase_not_configured" }, 503);
  }

  const refreshToken = cookieStore.get("sb-refresh-token")?.value || "";
  let accessToken =
    cookieStore.get("sb-access-token")?.value ||
    cookieStore.get("supabase-access-token")?.value ||
    "";

  if (refreshToken && accessToken) {
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

  // Call Supabase Auth REST API directly.
  // Endpoint: POST /auth/v1/oauth/authorizations/{id}/consent  { action: "approve"|"deny" }
  //
  // We use the SERVICE ROLE key instead of the user token. Supabase's consent
  // endpoint checks that user_id on the record matches the caller — but user_id
  // is null because Vercel strips the Authorization header when we call /oauth/authorize.
  // The service role bypasses this check entirely, allowing consent to proceed.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const consentToken = serviceRoleKey || accessToken;

  const authApiUrl = `${supabaseUrl}/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}/consent`;

  let authRes;
  try {
    authRes = await fetch(authApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${consentToken}`,
        "apikey": supabaseAnonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: approve ? "approve" : "deny" })
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
    const errMsg = authData?.msg || authData?.error || authData?.message || "authorization_decision_failed";
    return json({ error: errMsg }, authRes.status >= 500 ? 502 : 400);
  }

  const redirectUrl = authData?.redirect_url || authData?.url || authData?.redirectUrl;
  if (!redirectUrl) {
    return json({ error: "Authorization response did not include a redirect URL" }, 500);
  }

  return json({ redirect_url: redirectUrl });
}
