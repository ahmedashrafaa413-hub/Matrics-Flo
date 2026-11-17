import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/serverAuth";
import { getServerAccessToken, getServerRefreshToken } from "../../../../lib/supabaseServer";
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
  const refreshToken = getServerRefreshToken();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return json({ error: "supabase_not_configured" }, 503);
  }

  // Create a server-side client and inject the user's session
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Set the user's session so auth.oauth calls run in their context
  await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  if (!client.auth.oauth?.getAuthorizationDetails) {
    return json({ error: "OAuth server feature is not available in this Supabase SDK version" }, 503);
  }

  const { data, error } = await client.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error) {
    return json({ error: error.message || "authorization_lookup_failed" }, 400);
  }

  return json({ data });
}
