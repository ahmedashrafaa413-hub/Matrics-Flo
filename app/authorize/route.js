import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Compatibility endpoint for MCP clients that incorrectly resolve the
// authorization endpoint relative to the protected resource origin.
// Supabase remains the OAuth authorization server and issues all codes.
export function GET(request) {
  const url = new URL(request.url);
  const expected = "https://wegbjbrhygqqtczmqvoy.supabase.co";
  const allowed = new Set([
    "response_type", "client_id", "redirect_uri", "scope", "state",
    "code_challenge", "code_challenge_method", "resource"
  ]);
  if (url.searchParams.has("request_uri") || [...url.searchParams.keys()].some((k) => !allowed.has(k)) ||
      url.searchParams.get("response_type") !== "code" ||
      !url.searchParams.get("client_id") ||
      !url.searchParams.get("redirect_uri") ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      !url.searchParams.get("code_challenge")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const target = new URL("/auth/v1/oauth/authorize", expected);
  target.search = url.searchParams.toString();
  return NextResponse.redirect(target, { status: 302, headers: { "Cache-Control": "no-store" } });
}
