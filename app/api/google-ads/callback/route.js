import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { googleAdsRedirectUri, saveGoogleAdsConnectionFromOAuth } from "../../../../lib/googleAdsToken";
import { discoverGoogleAdsAccounts } from "../../../../lib/googleAdsApi.mjs";
import {
  clearOAuthStateCookie,
  getAppUrl,
  getRequiredEnv,
  verifyOAuthState
} from "../../../../lib/oauthFoundation.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const appUrl = getAppUrl(request);
  const back = (params) =>
    clearOAuthStateCookie(
      NextResponse.redirect(`${appUrl}/connections?${new URLSearchParams(params)}`),
      "google_ads"
    );

  try {
    await requireUser(request);
  } catch (authError) {
    return NextResponse.json(
      { success: false, error: authError.message || "Unauthorized" },
      { status: authError.status || 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (!verifyOAuthState(request, "google_ads", searchParams.get("state"))) {
    return back({ google_ads_error: "Invalid OAuth state" });
  }
  if (!code) return back({ google_ads_error: searchParams.get("error") || "Missing code" });

  let config;
  try {
    config = getRequiredEnv(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"]);
  } catch (error) {
    return back({ google_ads_error: error.message });
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleAdsRedirectUri(request),
      grant_type: "authorization_code"
    })
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    return back({ google_ads_error: tokenData?.error_description || tokenData?.error || "Token exchange failed" });
  }

  // Check the token and developer token actually reach Google Ads before saving.
  let accounts = [];
  try {
    ({ accounts } = await discoverGoogleAdsAccounts({
      accessToken: tokenData.access_token,
      developerToken: config.GOOGLE_ADS_DEVELOPER_TOKEN,
      loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || ""
    }));
  } catch (error) {
    return back({ google_ads_error: `Google Ads API: ${error.message}` });
  }

  const saved = await saveGoogleAdsConnectionFromOAuth({
    request,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in,
    scopes: String(tokenData.scope || "").split(" ").filter(Boolean),
    metadata: { source: "google_ads_oauth_callback", accounts_at_connect: accounts.length }
  });
  if (!saved.saved_to_db) return back({ google_ads_error: "Google Ads connected but was not saved to workspace" });
  if (!saved.has_refresh_token) return back({ google_ads_error: "Google did not return a refresh token; remove MetricsFlo from your Google account permissions and connect again" });

  return back({ google_ads: "connected", google_ads_accounts: String(accounts.length) });
}
