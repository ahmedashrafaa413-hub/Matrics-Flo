import { NextResponse } from "next/server";
import {
  getSnapchatAuthHeader,
  saveSnapchatConnectionFromOAuth
} from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

function getAppUrl(request) {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    new URL(request.url).origin
  );
}

export async function GET(request) {
  const url = new URL(request.url);

  const code = url.searchParams.get("code") || "";
  const error = url.searchParams.get("error") || "";

  const appUrl = getAppUrl(request);

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/connections?snapchat_error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${appUrl}/connections?snapchat_error=${encodeURIComponent(
        "Missing code"
      )}`
    );
  }

  try {
    const redirectUri = `${appUrl}/api/snapchat/callback`;

    const response = await fetch(
      "https://accounts.snapchat.com/accounts/oauth2/token",
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: getSnapchatAuthHeader()
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri
        })
      }
    );

    const text = await response.text();

    let data = null;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Snapchat token response was not JSON: ${text.slice(0, 120)}`
      );
    }

    if (!response.ok || !data.access_token) {
      throw new Error(
        data?.error_description ||
          data?.error ||
          "Snapchat OAuth token exchange failed"
      );
    }

    await saveSnapchatConnectionFromOAuth({
      request,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type || "Bearer",
      scopes: data.scope ? String(data.scope).split(" ") : [],
      metadata: {
        source: "snapchat_oauth_callback",
        redirect_uri: redirectUri
      }
    });

    return NextResponse.redirect(`${appUrl}/connections?snapchat=connected`);
  } catch (err) {
    return NextResponse.redirect(
      `${appUrl}/connections?snapchat_error=${encodeURIComponent(
        err.message || "Snapchat connection failed"
      )}`
    );
  }
}
