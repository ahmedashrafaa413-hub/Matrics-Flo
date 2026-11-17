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
  // Any authenticated user may connect an AI client — no owner restriction.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return reply(false, "supabase_not_configured", 503);

  // Accept token from Authorization header OR fall back to cookie-based auth.
  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!bearerToken) {
    // Cookie-based auth path
    try {
      const { getCurrentUser } = await import("../../../../lib/serverAuth");
      const { user } = await getCurrentUser(request);
      if (!user) return reply(false, "login_required", 401);
      return reply(true, "user_verified", 200);
    } catch {
      return reply(false, "login_required", 401);
    }
  }

  // Bearer token path — verify with Supabase
  try {
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return reply(false, "login_required", 401);
    return reply(true, "user_verified", 200);
  } catch {
    return reply(false, "authentication_unavailable", 503);
  }
}
