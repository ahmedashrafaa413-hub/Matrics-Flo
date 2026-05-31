import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const appId = process.env.META_APP_ID;

  if (!appId) {
    return NextResponse.json(
      { success: false, error: "META_APP_ID is missing" },
      { status: 500 }
    );
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "https://ad-intelligence-platform.vercel.app";

  const redirectUri = `${appUrl}/api/meta/callback`;
  const scope = ["ads_read", "ads_management", "business_management"].join(",");

  const authUrl =
    "https://www.facebook.com/v19.0/dialog/oauth" +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    "&response_type=code";

  return NextResponse.redirect(authUrl);
}
