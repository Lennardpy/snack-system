import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Called when a USB HID card reader fires a UID string at the kiosk page.
// Returns a short-lived shop token the browser navigates to.
export async function POST(req: NextRequest) {
  const { uid } = await req.json();

  if (!uid || typeof uid !== "string") {
    return NextResponse.json({ error: "Missing uid" }, { status: 400 });
  }

  const card = await prisma.card.findUnique({
    where: { uid: uid.trim().toUpperCase() },
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

  return NextResponse.json({ token: session.token, memberName: card.member.firstName });
}
