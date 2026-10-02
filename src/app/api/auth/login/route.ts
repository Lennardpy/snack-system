import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { createSession, setSessionCookie } from "@/lib/auth";

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

  const session = await createSession(user.id, "password"); // 7 days

  const res = NextResponse.json({ ok: true, role: user.role });
  setSessionCookie(res, session);

  return res;
}
