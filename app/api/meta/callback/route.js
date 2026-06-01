import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json(
      { success: false, error: "No code received" },
      { status: 400 }
    );
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!appId || !appSecret || !appUrl || !supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { success: false, error: "Missing environment variables" },
      { status: 500 }
    );
  }

  const redirectUri = `${appUrl}/api/meta/callback`;

  try {
    const shortTokenUrl =
      "https://graph.facebook.com/v19.0/oauth/access_token" +
      `?client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code=${encodeURIComponent(code)}`;

    const shortRes = await fetch(shortTokenUrl, { cache: "no-store" });
    const shortData = await shortRes.json();

    if (!shortData.access_token) {
      return NextResponse.json(
        { success: false, step: "short_token", error: shortData },
        { status: 400 }
      );
    }

    const longTokenUrl =
      "https://graph.facebook.com/v19.0/oauth/access_token" +
      `?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(shortData.access_token)}`;

    const longRes = await fetch(longTokenUrl, { cache: "no-store" });
    const longData = await longRes.json();

    if (!longData.access_token) {
      return NextResponse.json(
        { success: false, step: "long_token", error: longData },
        { status: 400 }
      );
    }

    const expiresIn = longData.expires_in || 60 * 60 * 24 * 60;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error } = await supabase.from("meta_connections").upsert(
      {
        user_id: "default_user",
        access_token: longData.access_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    );

    if (error) {
      return NextResponse.json(
        { success: false, step: "supabase_save", error },
        { status: 500 }
      );
    }

    const response = NextResponse.redirect(
      `${appUrl}/connections?meta=connected`
    );

    response.cookies.set("meta_token", longData.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: expiresIn
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
