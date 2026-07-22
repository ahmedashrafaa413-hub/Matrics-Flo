import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import {
  createOAuthState,
  getRequiredEnv,
  setOAuthStateCookie
} from "../../../../lib/oauthFoundation.mjs";

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

  let config;
  try {
    config = getRequiredEnv(["SALLA_CLIENT_ID", "SALLA_REDIRECT_URI"]);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const state = createOAuthState();

  const authUrl =
    "https://accounts.salla.sa/oauth2/auth" +
    `?client_id=${encodeURIComponent(config.SALLA_CLIENT_ID)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(config.SALLA_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent("offline_access orders.read")}` +
    `&state=${encodeURIComponent(state)}`;

  return setOAuthStateCookie(NextResponse.redirect(authUrl), "salla", state);
}
