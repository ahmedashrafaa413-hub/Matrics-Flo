import { NextResponse } from "next/server";

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    const accessToken = body.access_token || body.accessToken || "";
    const refreshToken = body.refresh_token || body.refreshToken || "";
    const expiresIn = Number(body.expires_in || body.expiresIn || 60 * 60);

    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          error: "access_token is required"
        },
        { status: 400 }
      );
    }

    const response = NextResponse.json({
      success: true
    });

    response.cookies.set("sb-access-token", accessToken, cookieOptions(expiresIn));
    response.cookies.set(
      "supabase-access-token",
      accessToken,
      cookieOptions(expiresIn)
    );

    if (refreshToken) {
      response.cookies.set(
        "sb-refresh-token",
        refreshToken,
        cookieOptions(60 * 60 * 24 * 180)
      );
    }

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to save session"
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({
    success: true
  });

  response.cookies.delete("sb-access-token");
  response.cookies.delete("supabase-access-token");
  response.cookies.delete("sb-refresh-token");
  response.cookies.delete("metricsflo_active_workspace");

  return response;
}
