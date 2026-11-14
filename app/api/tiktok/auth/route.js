import { NextResponse } from "next/server";
import { getActiveWorkspace } from "../../../../lib/workspace";
import { requireWorkspaceRole } from "../../../../lib/tenantFoundation.mjs";
import { createOAuthState, getAppUrl, getRequiredEnv, setOAuthStateCookie } from "../../../../lib/oauthFoundation.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { workspace } = await getActiveWorkspace(request);
    requireWorkspaceRole(workspace, "admin");
    const { TIKTOK_APP_ID } = getRequiredEnv(["TIKTOK_APP_ID"]);
    const state = createOAuthState();
    const redirectUri = `${getAppUrl(request)}/api/tiktok/callback`;
    const url = new URL("https://business-api.tiktok.com/portal/auth");
    url.searchParams.set("app_id", TIKTOK_APP_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return setOAuthStateCookie(NextResponse.redirect(url), "tiktok", state);
  } catch (error) {
    return NextResponse.json({ success:false, error:error.message || "TikTok authorization failed" }, { status:error.status || 500 });
  }
}
