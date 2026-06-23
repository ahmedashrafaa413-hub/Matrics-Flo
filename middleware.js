import { NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/auth/callback",
  "/api/auth",
  "/api/health",
  "/_next",
  "/favicon.ico"
];

function isPublicPath(pathname) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(path)
  );
}

function hasAuthCookie(request) {
  return Boolean(
    request.cookies.get("sb-access-token")?.value ||
      request.cookies.get("supabase-access-token")?.value ||
      request.cookies.get("sb-refresh-token")?.value ||
      request.cookies.get("access_token")?.value
  );
}

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const isProtectedPage =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/performance-overview") ||
    pathname.startsWith("/meta") ||
    pathname.startsWith("/snapchat") ||
    pathname.startsWith("/salla") ||
    pathname.startsWith("/ga") ||
    pathname.startsWith("/connections") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/agency");

  if (!isProtectedPage) {
    return NextResponse.next();
  }

  if (!hasAuthCookie(request)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/performance-overview/:path*",
    "/meta/:path*",
    "/snapchat/:path*",
    "/salla/:path*",
    "/ga/:path*",
    "/connections/:path*",
    "/settings/:path*",
    "/agency/:path*"
  ]
};
