import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function isApprovedOrigin(url) {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return host === "metricsflo.com" ||
    host === "www.metricsflo.com" ||
    /^ad-intelligence-platform-[a-z0-9-]+-ahmed-ashraf-projects\.vercel\.app$/.test(host);
}

// RFC 9728 protected resource metadata. Never trust arbitrary Host headers.
export async function GET(request) {
  try {
    const requestOrigin = new URL(request.url);
    const issuer = new URL("/auth/v1", process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!isApprovedOrigin(requestOrigin) ||
        issuer.protocol !== "https:" || issuer.username || issuer.password ||
        issuer.hostname !== "wegbjbrhygqqtczmqvoy.supabase.co") {
      throw new Error("Invalid OAuth discovery configuration");
    }
    return NextResponse.json({
      resource: new URL("/api/mcp", requestOrigin.origin).toString(),
      authorization_servers: [issuer.toString()],
      bearer_methods_supported: ["header"]
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "OAuth discovery is not configured" }, { status: 503 });
  }
}
