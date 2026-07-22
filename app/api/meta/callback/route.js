import { NextResponse } from "next/server";
import { saveMetaConnectionFromOAuth } from "../../../../lib/metaToken";
import { upsertPlatformConnection } from "../../../../lib/platformConnections";
import { requireUser } from "../../../../lib/serverAuth";
import {
  clearOAuthStateCookie,
  getAppUrl,
  getRequiredEnv,
  verifyOAuthState
} from "../../../../lib/oauthFoundation.mjs";

export const dynamic = "force-dynamic";

const GRAPH_VERSION = "v19.0";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const error = url.searchParams.get("error") || "";
  const state = url.searchParams.get("state") || "";

  const appUrl = getAppUrl(request);

  try {
    await requireUser(request);
  } catch (authError) {
    return NextResponse.redirect(
      `${appUrl}/login?next=${encodeURIComponent("/connections")}`
    );
  }

  if (!verifyOAuthState(request, "meta", state)) {
    return NextResponse.redirect(`${appUrl}/connections?meta_error=Invalid+OAuth+state`);
  }

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/connections?meta_error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${appUrl}/connections?meta_error=${encodeURIComponent("Missing code")}`
    );
  }

  try {
    const config = getRequiredEnv(["META_APP_ID", "META_APP_SECRET"]);
    const appId = config.META_APP_ID;
    const appSecret = config.META_APP_SECRET;
    const redirectUri = `${appUrl}/api/meta/callback`;

    // Exchange code for a short-lived token
    const tokenUrl = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`;
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code
      })
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      throw new Error(
        tokenData?.error?.message || "Meta short-lived token exchange failed"
      );
    }

    // Convert to a long-lived token (~60 days)
    const longTokenUrl = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`;
    const longRes = await fetch(longTokenUrl, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: tokenData.access_token
      })
    });
    const longData = await longRes.json();

    const finalToken = longData.access_token || tokenData.access_token;
    const expiresIn = longData.expires_in || tokenData.expires_in || 0;

    // Save the workspace-level Meta connection (the master token)
    const saved = await saveMetaConnectionFromOAuth({
      request,
      accessToken: finalToken,
      expiresIn,
      metadata: {
        source: "meta_oauth_callback",
        redirect_uri: redirectUri
      }
    });

    if (!saved?.saved_to_db) {
      return NextResponse.redirect(
        `${appUrl}/connections?meta_error=${encodeURIComponent(
          "Meta connected but was not saved to workspace. Please login again."
        )}`
      );
    }

    // Discover ad accounts under this token and register each one against
    // the same workspace so /api/meta/accounts can list them per-workspace.
    try {
      const accountsRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/me/adaccounts` +
          `?fields=id,name,account_status,currency`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${finalToken}` }
        }
      );

      const accountsData = await accountsRes.json();

      for (const account of accountsData?.data || []) {
        await upsertPlatformConnection({
          request,
          provider: "meta",
          accountId: account.id,
          accountName: account.name || account.id,
          accountCurrency: account.currency || "USD",
          accessToken: "",
          refreshToken: "",
          tokenType: "Bearer",
          expiresAt: null,
          scopes: [],
          metadata: {
            account_status: account.account_status,
            parent_connection_id: saved.connection?.id,
            connection_type: "meta_ad_account"
          }
        });
      }
    } catch {
      // Non-fatal — the master connection is saved either way; accounts
      // will simply be (re)discovered next time /api/meta/accounts runs.
    }

    return clearOAuthStateCookie(
      NextResponse.redirect(`${appUrl}/connections?meta=connected`),
      "meta"
    );
  } catch (err) {
    return NextResponse.redirect(
      `${appUrl}/connections?meta_error=${encodeURIComponent(
        err.message || "Meta connection failed"
      )}`
    );
  }
}
