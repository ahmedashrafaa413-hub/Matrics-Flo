import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { saveGaConnectionFromOAuth } from "../../../../lib/gaToken";

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
    return NextResponse.json({ success: false, error: "No code received" });
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code"
    })
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json({
      success: false,
      step: "token_exchange",
      error: tokenData
    });
  }

  const saved = await saveGaConnectionFromOAuth({
    request,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in,
    propertyId: null,
    propertyName: null,
    metadata: {
      source: "ga_oauth_callback"
    }
  });

  if (!saved?.saved_to_db) {
    return NextResponse.json({
      success: false,
      step: "supabase_save",
      error: "GA4 connected but was not saved to workspace"
    });
  }

  const appUrl = getAppUrl(request);
  return NextResponse.redirect(`${appUrl}/connections?ga=connected`);
}
