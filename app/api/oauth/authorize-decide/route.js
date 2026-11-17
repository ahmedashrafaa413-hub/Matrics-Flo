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

  // 2. Check the requesting user is logged in and is the owner
  const owner = process.env.METRICSFLO_AI_OWNER_USER_ID;
  if (!owner) return json({ error: "owner_not_configured" }, 503);

  try {
    const { user } = await getCurrentUser(request);
    if (!user) return json({ error: "login_required" }, 401);
    if (user.id !== owner) return json({ error: "account_not_authorized" }, 403);
  } catch {
    return json({ error: "authentication_unavailable" }, 503);
  }

  // 3. Get the user's access token to call auth.oauth (user-facing, needs JWT)
  const accessToken = getServerAccessToken(request);
  if (!accessToken) return json({ error: "login_required" }, 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return json({ error: "supabase_not_configured" }, 503);
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
