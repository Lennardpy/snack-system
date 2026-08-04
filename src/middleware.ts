import { NextRequest, NextResponse } from "next/server";

// Routes that require an active session cookie. Fine-grained role checks
// (admin-only vs bartender) live in the route handlers / layouts; this is a
// coarse "must be signed in" gate.
const PROTECTED_PREFIXES = ["/admin", "/api/admin", "/ppp", "/api/ppp"];

// Pages that are publicly accessible despite sitting under a protected prefix.
const PUBLIC_ADMIN = ["/admin/login", "/ppp/login"];

// The bar POS has its own vanity domain. A visit to ppp.51vo.nl lands directly on
// the PPP on the canonical domain (where cookies, the PWA manifest, etc. live).
const PPP_HOST = "ppp.51vo.nl";
const CANONICAL_HOST = "snacks.51vo.nl";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ppp.51vo.nl/* → snacks.51vo.nl/ppp (canonical domain), preserving any subpath.
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  if (host === PPP_HOST || host === `www.${PPP_HOST}`) {
    const target = pathname === "/" ? "/ppp" : pathname.startsWith("/ppp") ? pathname : `/ppp${pathname}`;
    return NextResponse.redirect(`https://${CANONICAL_HOST}${target}${req.nextUrl.search}`, 307);
  }

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
  // Run on everything except Next internals and static assets, so the
  // ppp.51vo.nl host redirect can fire on the bare domain ("/"). Auth gating
  // still only acts on the protected prefixes above; other paths pass through.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webmanifest)$).*)",
  ],
};
