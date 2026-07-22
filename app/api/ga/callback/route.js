import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { saveGaConnectionFromOAuth } from "../../../../lib/gaToken";
import {
  clearOAuthStateCookie,
  getAppUrl,
  getRequiredEnv,
  verifyOAuthState
} from "../../../../lib/oauthFoundation.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const appUrl = getAppUrl(request);
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
  const state = searchParams.get("state");

  if (!verifyOAuthState(request, "ga", state)) {
    return NextResponse.redirect(`${appUrl}/connections?ga_error=Invalid+OAuth+state`);
  }

  if (!code) {
    return NextResponse.redirect(`${appUrl}/connections?ga_error=Missing+code`);
  }

  let config;
  try {
    config = getRequiredEnv([
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI"
    ]);
  } catch (error) {
    return NextResponse.redirect(
      `${appUrl}/connections?ga_error=${encodeURIComponent(error.message)}`
    );
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code"
    })
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return clearOAuthStateCookie(
      NextResponse.redirect(
        `${appUrl}/connections?ga_error=${encodeURIComponent(
          tokenData?.error_description || tokenData?.error || "Token exchange failed"
        )}`
      ),
      "ga"
    );
  }

  const saved = await saveGaConnectionFromOAuth({
    request,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in,
    propertyId: null,
    propertyName: null,
    metadata: {
      source: "ga_oauth_callback"
    }
  });

  if (!saved?.saved_to_db) {
    return NextResponse.json({
      success: false,
      step: "supabase_save",
      error: "GA4 connected but was not saved to workspace"
    });
  }

  return clearOAuthStateCookie(
    NextResponse.redirect(`${appUrl}/connections?ga=connected`),
    "ga"
  );
}
