import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, canUseSite, homePath } from "@/lib/auth";
import { siteForHost } from "@/lib/site";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";

// Validate a set-password token (used by the /set-password page on load).
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const setup = await prisma.passwordSetupToken.findUnique({
    where: { token },
    include: { user: { select: { email: true } } },
  });
  if (!setup) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  if (setup.usedAt) return NextResponse.json({ error: "This link has already been used" }, { status: 410 });

  return NextResponse.json({ email: setup.user.email });
}

// Set the account password from a (non-expiring, single-use) token, then log in.
export async function POST(req: NextRequest) {
  if (!rateLimit(`set-password:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const { token, password } = await req.json();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const setup = await prisma.passwordSetupToken.findUnique({ where: { token } });
  if (!setup) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  if (setup.usedAt) return NextResponse.json({ error: "This link has already been used" }, { status: 410 });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: setup.userId } });
  const site = siteForHost(req.headers.get("host"));

  // Consume the link, set the password, end every existing session of the account
  // (a password change logs out everywhere) and — if the account may use this
  // site — start a session here. All atomically; the link is consumed only if
  // still unused, so two simultaneous submits can't both succeed.
  const session = await prisma.$transaction(async (tx) => {
    const { count } = await tx.passwordSetupToken.updateMany({
      where: { id: setup.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) return "used" as const;
    await tx.user.update({ where: { id: setup.userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: setup.userId } });
    if (!canUseSite(user, site)) return null;
    return tx.session.create({
      data: {
        userId: setup.userId,
        kind: "password",
        site,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  });
  if (session === "used") return NextResponse.json({ error: "This link has already been used" }, { status: 410 });

  const res = NextResponse.json({ ok: true, home: session ? homePath(user, site) : null });
  if (session) setSessionCookie(res, session);
  return res;
}
