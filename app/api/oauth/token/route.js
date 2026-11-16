import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// OAuth token proxy: forwards authorization_code and refresh_token exchanges
// to Supabase's /auth/v1/oauth/token endpoint (NOT the regular /auth/v1/token).
//
// Why this is needed:
// - Supabase's OIDC discovery doc advertises /auth/v1/token as the token_endpoint,
//   which only handles password/refresh flows — NOT authorization_code for OAuth clients.
// - The correct endpoint for third-party OAuth client token exchange is /auth/v1/oauth/token.
// - By hosting our own authorization server discovery at metricsflo.com we can point
//   Claude.ai at this proxy which forwards to the right Supabase endpoint.

const SUPABASE_OAUTH_TOKEN_URL = (() => {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    return new URL("/auth/v1/oauth/token", base).toString();
  } catch {
    return null;
  }
})();

const ALLOWED_GRANT_TYPES = new Set(["authorization_code", "refresh_token"]);

export async function POST(request) {
  if (!SUPABASE_OAUTH_TOKEN_URL) {
    return NextResponse.json({ error: "server_error", error_description: "OAuth token endpoint is not configured" }, { status: 503 });
  }

  let body;
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await request.text();
      body = Object.fromEntries(new URLSearchParams(text));
    } else if (contentType.includes("application/json")) {
      body = await request.json();
    } else {
      body = Object.fromEntries(new URLSearchParams(await request.text()));
    }
  } catch {
    return NextResponse.json({ error: "invalid_request", error_description: "Could not parse request body" }, { status: 400 });
  }

  const grantType = body?.grant_type;
  if (!grantType || !ALLOWED_GRANT_TYPES.has(grantType)) {
    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  // Forward to Supabase's OAuth token endpoint.
  // Preserve all original parameters (client_id, code, code_verifier, redirect_uri, etc.)
  try {
    const upstream = await fetch(SUPABASE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: new URLSearchParams(body).toString(),
      cache: "no-store"
    });

    const responseText = await upstream.text();
    let responseBody;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      // Supabase returned non-JSON — surface the status
      return NextResponse.json(
        { error: "server_error", error_description: "Unexpected response from authorization server" },
        { status: upstream.ok ? 500 : upstream.status }
      );
    }

    return NextResponse.json(responseBody, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch {
    return NextResponse.json(
      { error: "server_error", error_description: "Failed to reach authorization server" },
      { status: 502 }
    );
  }
}

// CORS preflight for browsers / MCP clients that send OPTIONS first
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store"
    }
  });
}
