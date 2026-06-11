import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { normalizeUid } from "@/lib/card";

// Called when the card reader fires a UID string at the kiosk page.
// Returns a short-lived shop token the browser navigates to.
//
// SECURITY: This endpoint is necessarily unauthenticated (the kiosk is a public
// web page). Card UIDs are not secrets, so we (a) never echo member data back,
// and (b) rate-limit per IP to make UID brute-forcing impractical. For stronger
// protection, restrict this route to the kiosk's IP at the network layer.
export async function POST(req: NextRequest) {
  // Generous limit: a real kiosk does a handful of scans per minute; this only
  // bites an attacker hammering UIDs.
  if (!rateLimit(`scan:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { uid } = await req.json();

  if (!uid || typeof uid !== "string") {
    return NextResponse.json({ error: "Missing uid" }, { status: 400 });
  }

  const card = await prisma.card.findUnique({
    where: { uid: normalizeUid(uid) },
    include: { member: true },
  });

  if (!card) {
    return NextResponse.json({ error: "Card not registered" }, { status: 404 });
  }

  if (!card.member.active) {
    return NextResponse.json({ error: "Member inactive" }, { status: 403 });
  }

  // Expire any existing session for this member
  await prisma.shopSession.deleteMany({ where: { memberId: card.memberId } });

  const session = await prisma.shopSession.create({
    data: {
      memberId: card.memberId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  });

  // Return only the opaque session token — never member data. The shop page
  // loads what it needs via the token-scoped /api/cart endpoint.
  return NextResponse.json({ token: session.token });
}
