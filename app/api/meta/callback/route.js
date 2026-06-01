import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json(
        {
          success: false,
          error: "No code received"
        },
        { status: 400 }
      );
    }

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL;

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const supabaseServiceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    const redirectUri =
      `${appUrl}/api/meta/callback`;

    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey
    );

    // Exchange code for short-lived token

    const tokenUrl =
      `https://graph.facebook.com/v19.0/oauth/access_token` +
      `?client_id=${appId}` +
      `&client_secret=${appSecret}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code=${encodeURIComponent(code)}`;

    const tokenRes = await fetch(tokenUrl);

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return NextResponse.json(
        {
          success: false,
          step: "short_lived_token",
          error: tokenData
        },
        { status: 400 }
      );
    }

    // Convert to long-lived token

    const longTokenUrl =
      `https://graph.facebook.com/v19.0/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${appId}` +
      `&client_secret=${appSecret}` +
      `&fb_exchange_token=${tokenData.access_token}`;

    const longRes = await fetch(longTokenUrl);

    const longData = await longRes.json();

    const finalToken =
      longData.access_token || tokenData.access_token;

    const expiresIn =
      longData.expires_in || 0;

    let expiresAt = null;

    if (expiresIn) {
      expiresAt = new Date(
        Date.now() + expiresIn * 1000
      ).toISOString();
    }

    // Get Ad Accounts

    const accountsRes = await fetch(
      `https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_status&access_token=${finalToken}`
    );

    const accountsData =
      await accountsRes.json();

    let primaryAdAccount = null;

    if (
      accountsData.data &&
      accountsData.data.length > 0
    ) {
      primaryAdAccount =
        accountsData.data[0].id;
    }

    // Save in Supabase

    const { error } = await supabase
      .from("meta_connections")
      .upsert(
        {
          user_id: "default_user",
          access_token: finalToken,
          ad_account_id: primaryAdAccount,
          expires_at: expiresAt,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: "user_id"
        }
      );

    if (error) {
      return NextResponse.json(
        {
          success: false,
          step: "supabase_save",
          error
        },
        { status: 500 }
      );
    }

    return NextResponse.redirect(
      `${appUrl}/connections?meta=connected`
    );

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message
      },
      { status: 500 }
    );
  }
}
