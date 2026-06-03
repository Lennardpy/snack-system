import { NextRequest, NextResponse } from "next/server";

// Routes that require an active session cookie
const PROTECTED_PREFIXES = ["/admin", "/api/admin"];

// Admin pages that are publicly accessible
const PUBLIC_ADMIN = ["/admin/login"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  const isPublic = PUBLIC_ADMIN.some((p) => pathname.startsWith(p));

  if (!isProtected || isPublic) return NextResponse.next();

  const sessionToken = req.cookies.get("session")?.value;

  if (!sessionToken) {
    // API routes → 401 JSON
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Admin pages → redirect to login
    const loginUrl = new URL("/admin/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
