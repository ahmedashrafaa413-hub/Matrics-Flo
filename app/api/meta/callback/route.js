import { NextResponse } from "next/server";

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

  const redirectUri = `${appUrl}/api/meta/callback`;

  const tokenUrl =
    "https://graph.facebook.com/v19.0/oauth/access_token" +
    `?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code=${encodeURIComponent(code)}`;

  const tokenRes = await fetch(tokenUrl, { cache: "no-store" });
  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    return NextResponse.json(
      { success: false, error: tokenData },
      { status: 400 }
    );
  }

  const response = NextResponse.redirect(`${appUrl}/dashboard?meta=connected`);

  response.cookies.set("meta_token", tokenData.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 60
  });

  return response;
}
