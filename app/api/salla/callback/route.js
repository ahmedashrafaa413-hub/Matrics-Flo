import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { saveSallaConnectionFromOAuth } from "../../../../lib/sallaToken";

export const dynamic = "force-dynamic";

function getAppUrl(request) {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    new URL(request.url).origin
  );
}

export async function GET(request) {
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
  const appUrl = getAppUrl(request);

  if (!code) {
    return NextResponse.json(
      { success: false, error: "No code received from Salla" },
      { status: 400 }
    );
  }

  const clientId = process.env.SALLA_CLIENT_ID;
  const clientSecret = process.env.SALLA_CLIENT_SECRET;
  const redirectUri = process.env.SALLA_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { success: false, error: "Missing Salla environment variables" },
      { status: 500 }
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
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
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
        redirect_uri: redirectUri
      }
    });

    if (!saved?.saved_to_db) {
      return NextResponse.redirect(
        `${appUrl}/connections?salla_error=${encodeURIComponent(
          "Salla connected but was not saved to workspace. Please login again."
        )}`
      );
    }

    return NextResponse.redirect(`${appUrl}/connections?salla=connected`);
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
