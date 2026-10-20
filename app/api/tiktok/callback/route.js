import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { clearOAuthStateCookie, getAppUrl, getRequiredEnv, verifyOAuthState } from "../../../../lib/oauthFoundation.mjs";
import { upsertPlatformConnection } from "../../../../lib/platformConnections";
import { tiktokRequest } from "../../../../lib/tiktokApi.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const appUrl = getAppUrl(request);
  const state = url.searchParams.get("state") || "";
  const authCode = url.searchParams.get("auth_code") || url.searchParams.get("code") || "";
  const providerError = url.searchParams.get("error") || "";
  try { await requireUser(request); } catch {
    return NextResponse.redirect(`${appUrl}/login?next=${encodeURIComponent("/connections")}`);
  }
  if (!verifyOAuthState(request, "tiktok", state)) return NextResponse.redirect(`${appUrl}/connections?tiktok_error=Invalid+OAuth+state`);
  if (providerError || !authCode) return NextResponse.redirect(`${appUrl}/connections?tiktok_error=${encodeURIComponent(providerError || "Missing authorization code")}`);

  try {
    const config = getRequiredEnv(["TIKTOK_APP_ID", "TIKTOK_APP_SECRET"]);
    const tokenData = await tiktokRequest("oauth2/access_token", {
      method:"POST", body:{ app_id:config.TIKTOK_APP_ID, secret:config.TIKTOK_APP_SECRET, auth_code:authCode }
    });
    if (!tokenData.access_token) throw new Error("TikTok did not return an access token");
    const advertiserIds = (tokenData.advertiser_ids || []).map(String);
    const master = await upsertPlatformConnection({
      request, provider:"tiktok", accountId:"tiktok_default", accountName:"TikTok Ads",
      accessToken:tokenData.access_token, tokenType:"Bearer", scopes:tokenData.scope || [],
      metadata:{ connection_type:"tiktok_master", advertiser_ids:advertiserIds, source:"tiktok_oauth_callback" }
    });
    for (const advertiserId of advertiserIds) {
      await upsertPlatformConnection({
        request, provider:"tiktok", accountId:advertiserId, accountName:`TikTok ${advertiserId}`,
        accessToken:"", refreshToken:"", metadata:{ connection_type:"tiktok_ad_account", parent_connection_id:master.connection.id }
      });
    }
    return clearOAuthStateCookie(NextResponse.redirect(`${appUrl}/connections?tiktok=connected`), "tiktok");
  } catch (error) {
    return NextResponse.redirect(`${appUrl}/connections?tiktok_error=${encodeURIComponent(error.message || "TikTok connection failed")}`);
  }
}
