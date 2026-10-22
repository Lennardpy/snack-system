import { NextRequest, NextResponse } from "next/server";
import { siteForHost, siteOrigin } from "@/lib/site";

// Routes that require an active session cookie. Fine-grained role checks
// (admin-only vs bartender) live in the route handlers / layouts; this is a
// coarse "must be signed in" gate.
const PROTECTED_PREFIXES = ["/admin", "/api/admin", "/ppp", "/api/ppp"];

// Pages that are publicly accessible despite sitting under a protected prefix.
const PUBLIC_ADMIN = ["/admin/login", "/ppp/login"];

// Two sites, one app (src/lib/site.ts): the snack system on snacks.51vo.nl and the
// bar system on ppp.51vo.nl. Paths of the other site redirect to its domain, so
// old bookmarks (snacks.51vo.nl/ppp, /admin/ppp/…) keep working.
const PPP_PATHS = ["/ppp", "/wallstreet"];
// What the PPP domain serves besides its own pages (APIs check the site themselves).
const PPP_SHARED = ["/api/", "/set-password", "/uploads/"];
// Old PPP admin URLs on the snack domain → the PPP admin.
const OLD_PPP_ADMIN = "/admin/ppp";

const startsWithAny = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const host = req.headers.get("host");
  const site = siteForHost(host);

  if (site === "ppp") {
    if (pathname === "/") return NextResponse.redirect(new URL("/ppp", req.url));
    if (!startsWithAny(pathname, [...PPP_PATHS, ...PPP_SHARED])) {
      return NextResponse.redirect(`${siteOrigin("sss", host)}${pathname}${search}`, 307);
    }
  } else {
    if (pathname === OLD_PPP_ADMIN || pathname.startsWith(`${OLD_PPP_ADMIN}/`)) {
      const rest = pathname.slice(OLD_PPP_ADMIN.length);
      return NextResponse.redirect(`${siteOrigin("ppp", host)}/ppp/admin${rest}${search}`, 307);
    }
    if (startsWithAny(pathname, PPP_PATHS)) {
      return NextResponse.redirect(`${siteOrigin("ppp", host)}${pathname}${search}`, 307);
    }
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
    // Protected pages → redirect to this site's login screen
    const loginUrl = new URL(site === "ppp" ? "/ppp/login" : "/admin/login", req.url);
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
