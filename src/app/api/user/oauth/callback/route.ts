import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAssociationId } from "@/lib/associations";
import {
  createMemberSession,
  MEMBER_COOKIE,
  memberCookieOptions,
  oauthConfig,
  STATE_COOKIE,
} from "@/lib/member-auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { siteForHost, siteOrigin } from "@/lib/site";

// GET /api/user/oauth/callback?code&state — back from Congressus: check the state,
// swap the code for a token, read who logged in (/oauth/userinfo: user_id = their
// Congressus member id, email) and sign them in to the portal if they're a member
// here. Failures go back to /user with an error code; nothing is revealed.
export async function GET(req: NextRequest) {
  const host = req.headers.get("host");
  const back = (error?: string) => {
    const res = NextResponse.redirect(new URL(error ? `/user?error=${error}` : "/user", siteOrigin("ppp", host)));
    res.cookies.set(STATE_COOKIE, "", { path: "/api/user/oauth", maxAge: 0 });
    return res;
  };
  if (siteForHost(host) !== "ppp") return back("unavailable");
  if (!rateLimit(`member-oauth:${clientIp(req)}`, 20, 60_000)) return back("busy");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const [association, expected = ""] = (req.cookies.get(STATE_COOKIE)?.value ?? "").split(".");
  const same =
    expected.length > 0 &&
    state.length === expected.length &&
    timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  if (!code || !same || !isAssociationId(association)) return back("expired");
  const cfg = oauthConfig(association);
  if (!cfg) return back("unavailable");

  let userId: number;
  let email: string;
  try {
    const tokenRes = await fetch(`${cfg.domain}/oauth/token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: `${siteOrigin("ppp", host)}/api/user/oauth/callback`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
    const { access_token } = await tokenRes.json();
    const infoRes = await fetch(`${cfg.domain}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!infoRes.ok) throw new Error(`userinfo ${infoRes.status}`);
    const info = await infoRes.json();
    userId = Number(info.user_id ?? info.sub);
    email = typeof info.email === "string" ? info.email : "";
  } catch (err) {
    console.error(`[member-login] ${association}: Congressus OAuth failed`, err);
    return back("failed");
  }

  // Their member row in that association: by Congressus id, else by email.
  const member =
    (Number.isInteger(userId)
      ? await prisma.member.findFirst({ where: { associationId: association, congressusId: userId, deletedAt: null } })
      : null) ??
    (email
      ? await prisma.member.findFirst({
          where: { associationId: association, email: { equals: email, mode: "insensitive" }, deletedAt: null },
        })
      : null);
  if (!member) return back("not-a-member");

  const session = await createMemberSession(member.id, association);
  const res = back();
  res.cookies.set(MEMBER_COOKIE, session.token, memberCookieOptions);
  return res;
}
