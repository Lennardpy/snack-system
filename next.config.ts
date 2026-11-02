import type { NextConfig } from "next";

// Security headers on every response. (A full script CSP needs nonces for Next's
// inline scripts; this CSP covers framing, <base> and plugins.)
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];

// Pages/endpoints that carry one-time tokens (card verification, password setup,
// shop sessions, auth) must never be cached by the browser or a proxy.
const NO_STORE = [{ key: "Cache-Control", value: "no-store" }];

const nextConfig: NextConfig = {
  // Local dev serves the PPP site on ppp.localhost (see src/lib/site.ts).
  allowedDevOrigins: ["ppp.localhost"],
  images: {
    // Product images served via /api/images/products/[filename] (Railway volume),
    // plus static assets in /public (logo, etc.)
    localPatterns: [
      { pathname: "/api/images/**" },
      { pathname: "/*.svg" },
      { pathname: "/*.png" },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/api/card/verify", headers: NO_STORE },
      { source: "/api/auth/:path*", headers: NO_STORE },
      { source: "/set-password", headers: NO_STORE },
      { source: "/shop/:path*", headers: NO_STORE },
    ];
  },
};

export default nextConfig;
