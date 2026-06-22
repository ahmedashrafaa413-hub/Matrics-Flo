import { NextResponse } from "next/server";

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
  const clientId = process.env.SNAPCHAT_CLIENT_ID;
  const appUrl = getAppUrl(request);
  const redirectUri = `${appUrl}/api/snapchat/callback`;

  if (!clientId) {
    return NextResponse.json(
      {
        success: false,
        error: "SNAPCHAT_CLIENT_ID not configured"
      },
      {
        status: 500
      }
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "snapchat-marketing-api"
  });

  const url = `https://accounts.snapchat.com/accounts/oauth2/auth?${params.toString()}`;

  return NextResponse.redirect(url);
}
