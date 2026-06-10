import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId    = process.env.SNAPCHAT_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/snapchat/callback`;

  if (!clientId) {
    return NextResponse.json(
      { error: "SNAPCHAT_CLIENT_ID not configured" },
      { status: 500 }
    );
  }

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         "snapchat-marketing-api",
  });

  const url = `https://accounts.snapchat.com/accounts/oauth2/auth?${params}`;
  return NextResponse.redirect(url);
}
