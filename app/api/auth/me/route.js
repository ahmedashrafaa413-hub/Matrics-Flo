import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { user, error } = await getCurrentUser(request);

  if (error || !user) {
    return NextResponse.json(
      { success: false, user: null, error: error || "Invalid session" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    user
  });
}
