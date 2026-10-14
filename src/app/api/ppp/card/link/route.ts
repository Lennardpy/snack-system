import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeUid } from "@/lib/card";
import { requireBartender } from "@/lib/auth";

// Link an unrecognised card to a member from the bar POS. The bartender scans a
// card that isn't in the shared Card table yet, searches the member by name, and
// links it here. The card then works everywhere (bar + snack kiosk), exactly like
// one linked via the kiosk's email flow — PPP keeps no card tables of its own.
//
// Body: { uid, memberId }. Returns the member (name + roles) so the POS can set
// them as the charge target immediately.
export async function POST(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { uid, memberId } = await req.json();
  if (!uid || typeof uid !== "string" || !memberId || typeof memberId !== "string") {
    return NextResponse.json({ error: "uid and memberId are required" }, { status: 400 });
  }

  const normalised = normalizeUid(uid);

  // If this card is already linked, don't silently move it to another member.
  const existing = await prisma.card.findUnique({
    where: { uid: normalised },
    include: { member: { select: { firstName: true, lastName: true } } },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: `Card is already linked to ${existing.member.firstName} ${existing.member.lastName}`,
      },
      { status: 409 }
    );
  }

  if (await prisma.externalCard.findUnique({ where: { uid: normalised } })) {
    return NextResponse.json({ error: "This is an external card — it can't be linked to a member" }, { status: 409 });
  }

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      roles: { select: { name: true, discountPercent: true, discountCents: true, ownDrinkOnly: true, color: true } },
    },
  });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (!member.active) return NextResponse.json({ error: "Member inactive" }, { status: 403 });

  await prisma.card.create({
    data: { uid: normalised, memberId: member.id, name: "Linked at the bar" },
  });

  return NextResponse.json({
    memberId: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    roles: member.roles,
  });
}
