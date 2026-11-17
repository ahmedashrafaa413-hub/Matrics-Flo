import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function reply(allowed, reason, status) {
  return NextResponse.json({ allowed, reason }, {
    status,
    headers: { "Cache-Control": "no-store, private" }
  });
}

export async function GET(request) {
  const owner = process.env.METRICSFLO_AI_OWNER_USER_ID;
  if (!owner) return reply(false, "owner_not_configured", 503);

  // Accept token from Authorization header (sent by consent page client-side)
  // OR from cookies (fallback for other callers)
  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!bearerToken) {
    // Fallback: try cookie-based auth via getCurrentUser
    try {
      const { getCurrentUser } = await import("../../../../lib/serverAuth");
      const { user } = await getCurrentUser(request);
      if (!user) return reply(false, "login_required", 401);
      if (user.id !== owner) return reply(false, "account_not_authorized", 403);
      return reply(true, "owner_verified", 200);
    } catch {
      return reply(false, "login_required", 401);
    }
  }

  // Verify bearer token with Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return reply(false, "supabase_not_configured", 503);

  try {
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return reply(false, "login_required", 401);
    if (user.id !== owner) return reply(false, "account_not_authorized", 403);
    return reply(true, "owner_verified", 200);
  } catch {
    return reply(false, "authentication_unavailable", 503);
  }
}
