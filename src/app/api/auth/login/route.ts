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

  const { email, password } = await req.json();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Separate logins per site: the account needs access to the site it signs in on.
  const site = siteForHost(req.headers.get("host"));
  if (!canUseSite(user, site)) {
    return NextResponse.json(
      { error: site === "ppp" ? "This account has no access to the bar system (PPP)" : "This account has no access to the snack system (SSS)" },
      { status: 403 }
    );
  }

  const session = await createSession(user.id, "password", site); // 7 days

  const res = NextResponse.json({ ok: true, role: user.role, home: homePath(user, site) });
  setSessionCookie(res, session);

  return res;
}
