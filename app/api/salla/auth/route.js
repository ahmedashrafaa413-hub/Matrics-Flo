import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await requireUser(request);
  } catch (authError) {
    return NextResponse.json(
      { success: false, error: authError.message || "Unauthorized" },
      { status: authError.status || 401 }
    );
  }

  const clientId = process.env.SALLA_CLIENT_ID;
  const redirectUri = process.env.SALLA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { success: false, error: "Missing Salla environment variables" },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();

  const authUrl =
    "https://accounts.salla.sa/oauth2/auth" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent("offline_access orders.read")}` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.redirect(authUrl);
}
