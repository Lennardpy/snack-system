import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { normalizeUid } from "@/lib/card";
import { createSession, setSessionCookie, canUseSite } from "@/lib/auth";
import { siteForHost } from "@/lib/site";

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
  // Card login is for the bar POS only.
  if (siteForHost(req.headers.get("host")) !== "ppp" || !canUseSite(user, "ppp")) {
    return NextResponse.json({ error: "This account can't sign in here" }, { status: 403 });
  }
  if (!card.member.active) {
    return NextResponse.json({ error: "Member is inactive" }, { status: 403 });
  }

  // A short, sliding "card" session (see src/lib/auth.ts): alive while the POS is
  // used, gone 2 h after last use and at most 16 h — never carried to next borrel.
  const session = await createSession(user.id, "card", "ppp");

  const res = NextResponse.json({ ok: true, role: user.role });
  setSessionCookie(res, session);
  return res;
}
