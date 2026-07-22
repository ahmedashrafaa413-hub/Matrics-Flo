import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { saveSallaConnectionFromOAuth } from "../../../../lib/sallaToken";
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

  if (!verifyOAuthState(request, "salla", state)) {
    return NextResponse.redirect(`${appUrl}/connections?salla_error=Invalid+OAuth+state`);
  }

  if (!code) {
    return NextResponse.json(
      { success: false, error: "No code received from Salla" },
      { status: 400 }
    );
  }

  let config;
  try {
    config = getRequiredEnv([
      "SALLA_CLIENT_ID",
      "SALLA_CLIENT_SECRET",
      "SALLA_REDIRECT_URI"
    ]);
  } catch (error) {
    return NextResponse.redirect(
      `${appUrl}/connections?salla_error=${encodeURIComponent(error.message)}`
    );
  }

  try {
    const tokenRes = await fetch("https://accounts.salla.sa/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.SALLA_CLIENT_ID,
        client_secret: config.SALLA_CLIENT_SECRET,
        redirect_uri: config.SALLA_REDIRECT_URI,
        code
      }),
      cache: "no-store"
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      return NextResponse.json(
        { success: false, step: "token_exchange", error: tokenData },
        { status: 400 }
      );
    }

    let storeName = null;
    let merchantId = null;

    try {
      const userRes = await fetch("https://accounts.salla.sa/oauth2/user/info", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        },
        cache: "no-store"
      });

      const userData = await userRes.json();

      merchantId =
        userData?.data?.merchant?.id ||
        userData?.data?.id ||
        userData?.merchant?.id ||
        null;

      storeName =
        userData?.data?.merchant?.name ||
        userData?.data?.store?.name ||
        userData?.data?.name ||
        "Salla Store";
    } catch (userError) {
      storeName = "Salla Store";
      merchantId = null;
    }

    const saved = await saveSallaConnectionFromOAuth({
      request,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      merchantId,
      storeName,
      metadata: {
        source: "salla_oauth_callback",
        redirect_uri: config.SALLA_REDIRECT_URI
      }
    });

    if (!saved?.saved_to_db) {
      return NextResponse.redirect(
        `${appUrl}/connections?salla_error=${encodeURIComponent(
          "Salla connected but was not saved to workspace. Please login again."
        )}`
      );
    }

    return clearOAuthStateCookie(
      NextResponse.redirect(`${appUrl}/connections?salla=connected`),
      "salla"
    );
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Salla callback failed"
      },
      { status: 500 }
    );
  }
}
