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
    config = getRequiredEnv(["GOOGLE_CLIENT_ID", "GOOGLE_REDIRECT_URI"]);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const state = createOAuthState();

  const scope = [
    "https://www.googleapis.com/auth/analytics.readonly"
  ].join(" ");

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope,
      state
    });

  return setOAuthStateCookie(NextResponse.redirect(authUrl), "ga", state);
}
