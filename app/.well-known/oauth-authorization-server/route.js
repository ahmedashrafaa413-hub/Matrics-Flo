import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// RFC 8414: OAuth 2.0 Authorization Server Metadata
// Hosts the discovery document on metricsflo.com so Claude.ai can find the
// correct Supabase OAuth endpoints (specifically /auth/v1/oauth/token for
// authorization_code exchange, NOT the regular /auth/v1/token endpoint).
//
// Flow:
// 1. Claude reads /.well-known/oauth-protected-resource/mcp
//    → authorization_servers: ["https://metricsflo.com"]
// 2. Claude fetches https://metricsflo.com/.well-known/oauth-authorization-server
//    → this document, which points to our /authorize and /api/oauth/token proxies
// 3. Claude POSTs authorization_code to /api/oauth/token
//    → proxy forwards to https://...supabase.co/auth/v1/oauth/token

function isApprovedOrigin(url) {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return (
    host === "metricsflo.com" ||
    host === "www.metricsflo.com" ||
    /^ad-intelligence-platform-[a-z0-9-]+-ahmed-ashraf-projects\.vercel\.app$/.test(host)
  );
}

export async function GET(request) {
  try {
    const requestOrigin = new URL(request.url);
    if (!isApprovedOrigin(requestOrigin)) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const base = requestOrigin.origin;

    return NextResponse.json(
      {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/api/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["email"]
      },
      { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } }
    );
  } catch {
    return NextResponse.json({ error: "discovery_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
