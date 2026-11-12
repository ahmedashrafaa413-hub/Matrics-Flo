import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";
export async function GET(request) {
  try {
    const owner = process.env.METRICSFLO_AI_OWNER_USER_ID;
    if (!owner) return NextResponse.json({ allowed: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const user = await requireUser(request);
    if (user.id !== owner) return NextResponse.json({ allowed: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ allowed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ allowed: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
}
