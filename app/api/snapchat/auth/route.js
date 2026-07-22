import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import {
  createOAuthState,
  getAppUrl,
  getRequiredEnv,
  setOAuthStateCookie
} from "../../../../lib/oauthFoundation.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await requireUser(request);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unauthorized" },
      { status: error.status || 401 }
    );
  }

  let config;
  try {
    config = getRequiredEnv(["SNAPCHAT_CLIENT_ID"]);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const appUrl = getAppUrl(request);
  const redirectUri = `${appUrl}/api/snapchat/callback`;
  const state = createOAuthState();

  const params = new URLSearchParams({
    client_id: config.SNAPCHAT_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "snapchat-marketing-api",
    state
  });

  const url = `https://accounts.snapchat.com/accounts/oauth2/auth?${params.toString()}`;

  return setOAuthStateCookie(NextResponse.redirect(url), "snapchat", state);
}
