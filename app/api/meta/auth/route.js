import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import {
  createOAuthState,
  getAppUrl,
  getRequiredEnv,
  setOAuthStateCookie
} from "../../../../lib/oauthFoundation.mjs";
import { getMetaGraphVersion } from "../../../../lib/metaApi.mjs";

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
    config = getRequiredEnv(["META_APP_ID"]);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const appUrl = getAppUrl(request);
  const redirectUri = `${appUrl}/api/meta/callback`;
  const state = createOAuthState();
  const scope = ["ads_read", "ads_management", "business_management"].join(",");

  const authUrl =
    `https://www.facebook.com/${getMetaGraphVersion()}/dialog/oauth` +
    `?client_id=${encodeURIComponent(config.META_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    "&response_type=code" +
    `&state=${encodeURIComponent(state)}`;

  return setOAuthStateCookie(NextResponse.redirect(authUrl), "meta", state);
}
