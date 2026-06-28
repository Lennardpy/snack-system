import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { normalizeUid } from "@/lib/card";

// Log a bartender in by scanning their card. Only works for a card whose member
// is linked to a BARTENDER/ADMIN account (User.memberId). A card UID is not a
// secret, so this is intentionally limited to staff accounts and rate-limited.
export async function POST(req: NextRequest) {
  if (!rateLimit(`card-login:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const { uid } = await req.json();
  if (!uid || typeof uid !== "string") {
    return NextResponse.json({ error: "Missing uid" }, { status: 400 });
  }

  const card = await prisma.card.findUnique({
    where: { uid: normalizeUid(uid) },
    include: { member: { include: { user: true } } },
  });

  const user = card?.member.user;
  if (!card || !user) {
    return NextResponse.json(
      { error: "This card isn't linked to a bartender account" },
      { status: 404 }
    );
  }
  if (user.role !== "BARTENDER" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "This account can't sign in here" }, { status: 403 });
  }
  if (!card.member.active) {
    return NextResponse.json({ error: "Member is inactive" }, { status: 403 });
  }

  const session = await prisma.session.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  });

  const res = NextResponse.json({ ok: true, role: user.role });
  res.cookies.set("session", session.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return res;
}
