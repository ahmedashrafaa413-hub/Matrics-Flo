import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";

function reply(allowed, reason, status) {
  return NextResponse.json({ allowed, reason }, {
    status,
    headers: { "Cache-Control": "no-store, private", "Vary": "Cookie" }
  });
}

export async function GET(request) {
  const owner = process.env.METRICSFLO_AI_OWNER_USER_ID;
  if (!owner) return reply(false, "owner_not_configured", 503);
  try {
    const { user } = await getCurrentUser(request);
    if (!user) return reply(false, "login_required", 401);
    if (user.id !== owner) return reply(false, "account_not_authorized", 403);
    return reply(true, "owner_verified", 200);
  } catch {
    return reply(false, "authentication_unavailable", 503);
  }
}
