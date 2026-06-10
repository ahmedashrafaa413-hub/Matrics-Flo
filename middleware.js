import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/select-workspace"];

export async function middleware(req) {
  const res  = NextResponse.next();
  const path = req.nextUrl.pathname;

  // Skip public paths and API routes
  if (
    PUBLIC_PATHS.some(p => path.startsWith(p)) ||
    path.startsWith("/api/") ||
    path.startsWith("/_next/")
  ) {
    return res;
  }

  const supabase = createMiddlewareClient({ req, res });
  const { data: { session } } = await supabase.auth.getSession();

  // Not logged in → redirect to login
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
