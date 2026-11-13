import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// RFC 9728: some OAuth clients discover the root protected-resource metadata
// before attempting the path-specific variant.
const allowedHost = (host) => host === "metricsflo.com" ||
  host === "www.metricsflo.com" ||
  /^ad-intelligence-platform-[a-z0-9-]+-ahmed-ashraf-projects\.vercel\.app$/.test(host);

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (url.protocol !== "https:" || !allowedHost(url.hostname) ||
        url.username || url.password || url.port ||
        supabase.origin !== "https://wegbjbrhygqqtczmqvoy.supabase.co") {
      throw new Error("Invalid OAuth metadata origin");
    }
    return NextResponse.json({
      resource: new URL("/api/mcp", url.origin).toString(),
      authorization_servers: [new URL("/auth/v1", supabase.origin).toString()],
      bearer_methods_supported: ["header"]
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "OAuth discovery is not configured" }, { status: 503 });
  }
}
