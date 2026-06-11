import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code  = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/connections?error=snapchat_denied`
    );
  }

  const clientId     = process.env.SNAPCHAT_CLIENT_ID;
  const clientSecret = process.env.SNAPCHAT_CLIENT_SECRET;
  const redirectUri  = `${process.env.NEXT_PUBLIC_APP_URL}/api/snapchat/callback`;

  try {
    const tokenRes = await fetch("https://accounts.snapchat.com/accounts/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type:   "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/connections?error=snapchat_token_failed`
      );
    }

    const cookieStore = cookies();
    const expiresIn   = tokenData.expires_in || 3600;
    const expiryTime  = Date.now() + expiresIn * 1000;

    const cookieOpts = {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      path:     "/",
    };

    // Access token
    cookieStore.set("snapchat_token", tokenData.access_token, {
      ...cookieOpts,
      maxAge: expiresIn,
    });

    // Expiry timestamp
    cookieStore.set("snapchat_token_expiry", String(expiryTime), {
      ...cookieOpts,
      maxAge: expiresIn + 60,
    });

    // Refresh token — 6 months
    if (tokenData.refresh_token) {
      cookieStore.set("snapchat_refresh_token", tokenData.refresh_token, {
        ...cookieOpts,
        maxAge: 60 * 60 * 24 * 180,
      });
    }

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/connections?success=snapchat`
    );
  } catch (err) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/connections?error=snapchat_error`
    );
  }
}
