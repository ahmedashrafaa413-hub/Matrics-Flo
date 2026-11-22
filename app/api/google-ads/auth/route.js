import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { GOOGLE_ADS_SCOPE } from "../../../../lib/googleAdsApi.mjs";
import { googleAdsRedirectUri } from "../../../../lib/googleAdsToken";
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
    config = getRequiredEnv(["GOOGLE_CLIENT_ID", "GOOGLE_ADS_DEVELOPER_TOKEN"]);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const state = createOAuthState();
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      redirect_uri: googleAdsRedirectUri(request),
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: GOOGLE_ADS_SCOPE,
      state
    });

  return setOAuthStateCookie(NextResponse.redirect(authUrl), "google_ads", state);
}
