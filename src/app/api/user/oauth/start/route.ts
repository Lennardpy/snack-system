import { NextRequest, NextResponse } from "next/server";
import { isAssociationId } from "@/lib/associations";
import { newToken, oauthConfig, STATE_COOKIE } from "@/lib/member-auth";
import { siteForHost, siteOrigin } from "@/lib/site";

// GET /api/user/oauth/start?association=stress|dimensie — sends the member to their
// association's Congressus login. A random state goes in a short-lived httpOnly
// cookie and is checked on the way back (CSRF / login-swap protection).
export async function GET(req: NextRequest) {
  const host = req.headers.get("host");
  const association = req.nextUrl.searchParams.get("association");
  const cfg = isAssociationId(association) ? oauthConfig(association) : null;
  if (siteForHost(host) !== "ppp" || !cfg || !isAssociationId(association)) {
    return NextResponse.redirect(new URL("/user?error=unavailable", siteOrigin("ppp", host)));
  }

  const state = newToken();
  const url = new URL(`${cfg.domain}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", `${siteOrigin("ppp", host)}/api/user/oauth/callback`);
  // Must be within the app's "Maximum access scope" in Congressus.
  url.searchParams.set("scope", process.env.CONGRESSUS_OAUTH_SCOPE?.trim() || "openid email profile");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, `${association}.${state}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/user/oauth",
    maxAge: 600,
  });
  return res;
}
