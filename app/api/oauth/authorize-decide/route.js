import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/serverAuth";
import { getServerAccessToken } from "../../../../lib/supabaseServer";
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

  // Pass the user's JWT via Authorization header — avoids setSession which requires
  // a valid refresh_token (which may not be available server-side across subdomains).
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  if (!client.auth.oauth?.approveAuthorization || !client.auth.oauth?.denyAuthorization) {
    return json({ error: "OAuth server feature is not available in this Supabase SDK version" }, 503);
  }

  const { data, error } = approve
    ? await client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await client.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });

  if (error) {
    return json({ error: error.message || "authorization_decision_failed" }, 400);
  }

  const redirectUrl = data?.redirect_url || data?.url || data?.redirectUrl;
  if (!redirectUrl) {
    return json({ error: "Authorization response did not include a redirect URL" }, 500);
  }

  return json({ redirect_url: redirectUrl });
}
