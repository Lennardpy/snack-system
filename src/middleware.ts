import { NextRequest, NextResponse } from "next/server";

// Routes that require an active session cookie. Fine-grained role checks
// (admin-only vs bartender) live in the route handlers / layouts; this is a
// coarse "must be signed in" gate.
const PROTECTED_PREFIXES = ["/admin", "/api/admin", "/ppp", "/api/ppp"];

// Pages that are publicly accessible despite sitting under a protected prefix.
const PUBLIC_ADMIN = ["/admin/login", "/ppp/login"];

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
    // Protected pages → redirect to the matching login screen
    const loginPath = pathname.startsWith("/ppp") ? "/ppp/login" : "/admin/login";
    const loginUrl = new URL(loginPath, req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/ppp/:path*",
    "/api/ppp/:path*",
  ],
};
