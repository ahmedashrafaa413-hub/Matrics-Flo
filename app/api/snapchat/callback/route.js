import { NextResponse } from "next/server";
import {
  getSnapchatAuthHeader,
  saveSnapchatConnectionFromOAuth
} from "../../../../lib/snapchatToken";
import { requireUser } from "../../../../lib/serverAuth";
import {
  clearOAuthStateCookie,
  getAppUrl,
  verifyOAuthState
} from "../../../../lib/oauthFoundation.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);

  const code = url.searchParams.get("code") || "";
  const error = url.searchParams.get("error") || "";
  const state = url.searchParams.get("state") || "";

  const appUrl = getAppUrl(request);

  try {
    await requireUser(request);
  } catch {
    return NextResponse.redirect(
      `${appUrl}/login?next=${encodeURIComponent("/connections")}`
    );
  }

  if (!verifyOAuthState(request, "snapchat", state)) {
    return NextResponse.redirect(
      `${appUrl}/connections?snapchat_error=Invalid+OAuth+state`
    );
  }

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

    const saved = await saveSnapchatConnectionFromOAuth({
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

    if (!saved?.saved_to_db) {
      return NextResponse.redirect(
        `${appUrl}/connections?snapchat_error=${encodeURIComponent(
          "Snapchat connected but was not saved to workspace. Please login again."
        )}`
      );
    }

    return clearOAuthStateCookie(
      NextResponse.redirect(`${appUrl}/connections?snapchat=connected`),
      "snapchat"
    );
  } catch (err) {
    return NextResponse.redirect(
      `${appUrl}/connections?snapchat_error=${encodeURIComponent(
        err.message || "Snapchat connection failed"
      )}`
    );
  }
}
