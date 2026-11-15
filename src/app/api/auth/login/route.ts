import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { createSession, setSessionCookie, canUseSite, homePath } from "@/lib/auth";
import { siteForHost } from "@/lib/site";

export async function POST(req: NextRequest) {
  // Throttle login attempts per IP to slow password brute-forcing.
  if (!rateLimit(`login:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

  // One email can have an admin and a bartender account (each with its own
  // password): sign in to the one whose password this is. If it's both, the one
  // that may use this site, the admin first (an admin can do everything a
  // bartender can).
  const site = siteForHost(req.headers.get("host"));
  const accounts = await prisma.user.findMany({ where: { email } });
  const matching = [];
  for (const a of accounts) if (await bcrypt.compare(password, a.passwordHash)) matching.push(a);
  if (matching.length === 0) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const user =
    matching.find((a) => a.role === "ADMIN" && canUseSite(a, site)) ??
    matching.find((a) => canUseSite(a, site)) ??
    matching[0];

  // Separate logins per site: the account needs access to the site it signs in on.
  if (!canUseSite(user, site)) {
    return NextResponse.json(
      { error: site === "ppp" ? "This account has no access to the bar system (PPP)" : "This account has no access to the snack system (SSS)" },
      { status: 403 }
    );
  }

  const session = await createSession(user, "password", site);

  const res = NextResponse.json({ ok: true, role: user.role, home: homePath(user, site) });
  setSessionCookie(res, session);

  return res;
}
