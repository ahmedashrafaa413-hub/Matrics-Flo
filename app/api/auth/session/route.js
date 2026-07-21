import { NextResponse } from "next/server";
import { getSupabasePublicClient } from "../../../../lib/serverAuth";
import {
  AUTH_COOKIE_NAMES,
  normalizeSessionMaxAge
} from "../../../../lib/authFoundation.mjs";

export const dynamic = "force-dynamic";

function getCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge
  };
}

function clearAuthCookies(response) {
  Object.values(AUTH_COOKIE_NAMES).forEach((name) => {
    response.cookies.delete(name);
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    const accessToken = body.access_token || body.accessToken || "";
    const refreshToken = body.refresh_token || body.refreshToken || "";
    const expiresIn = normalizeSessionMaxAge(
      body.expires_in || body.expiresIn
    );

    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          error: "access_token is required"
        },
        {
          status: 400
        }
      );
    }

    const supabase = getSupabasePublicClient();
    const { data, error } = await supabase.auth.getUser(accessToken);

    if (error || !data?.user) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid access token"
        },
        { status: 401 }
      );
    }

    const response = NextResponse.json({
      success: true,
      message: "Session saved successfully"
    });

    response.cookies.set(
      AUTH_COOKIE_NAMES.access,
      accessToken,
      getCookieOptions(expiresIn)
    );

    response.cookies.set(
      AUTH_COOKIE_NAMES.legacyAccess,
      accessToken,
      getCookieOptions(expiresIn)
    );

    if (refreshToken) {
      response.cookies.set(
        AUTH_COOKIE_NAMES.refresh,
        refreshToken,
        getCookieOptions(60 * 60 * 24 * 180)
      );
    }

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to save session"
      },
      {
        status: 500
      }
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({
    success: true,
    message: "Session cleared successfully"
  });

  clearAuthCookies(response);

  return response;
}
