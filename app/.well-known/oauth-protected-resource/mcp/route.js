import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// OAuth 2.0 Protected Resource Metadata (RFC 9728).
// Authorization is delegated to Supabase Auth's OAuth 2.1 server.
export async function GET(request) {
  const origin = process.env.METRICSFLO_PUBLIC_ORIGIN;
  const issuer = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let resource;
  let authorizationServer;
  try {
    resource = new URL("/api/mcp", origin);
    authorizationServer = new URL("/auth/v1", issuer);
    if (resource.protocol !== "https:" || authorizationServer.protocol !== "https:" ||
        resource.username || resource.password || authorizationServer.username || authorizationServer.password ||
        resource.origin !== new URL(request.url).origin) throw new Error("Invalid configuration");
  } catch {
    return NextResponse.json({ error: "OAuth discovery is not configured" }, { status: 503 });
  }
  return NextResponse.json({
    resource: resource.toString(),
    authorization_servers: [authorizationServer.toString()],
    bearer_methods_supported: ["header"]
  }, { headers: { "Cache-Control": "no-store" } });
}
