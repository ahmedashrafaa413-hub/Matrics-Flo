import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";

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

  if (!code) {
    return NextResponse.json(
      { success: false, error: "No code received from Salla" },
      { status: 400 }
    );
  }

  const clientId = process.env.SALLA_CLIENT_ID;
  const clientSecret = process.env.SALLA_CLIENT_SECRET;
  const redirectUri = process.env.SALLA_REDIRECT_URI;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !clientId ||
    !clientSecret ||
    !redirectUri ||
    !supabaseUrl ||
    !supabaseServiceKey
  ) {
    return NextResponse.json(
      { success: false, error: "Missing environment variables" },
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

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : null;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error } = await supabase.from("salla_connections").upsert(
      {
        user_id: "default_user",
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at: expiresAt,
        merchant_id: merchantId ? String(merchantId) : null,
        store_name: storeName,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "user_id"
      }
    );

    if (error) {
      return NextResponse.json(
        { success: false, step: "supabase_save", error },
        { status: 500 }
      );
    }

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL}/connections?salla=connected`
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
