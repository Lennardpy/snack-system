import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeUid } from "@/lib/card";
import { requireBartender } from "@/lib/auth";
import { resolvePayer, cardHolderFor } from "@/lib/memberships";
import { activityVisible } from "@/lib/scope-db";
import { posScope } from "@/lib/scope";

// Link an unrecognised card to a member from the bar POS. The bartender scans a
// card that isn't in the shared Card table yet, searches the member by name, and
// links it here. The card then works everywhere (bar + snack kiosk), exactly like
// one linked via the kiosk's email flow — PPP keeps no card tables of its own.
//
// Body: { uid, memberId, activityId }. Someone in both associations is one person:
// the card is linked once and works for both memberships. Returns the membership
// that pays at this borrel (name + roles) so the POS can charge them immediately.
export async function POST(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { uid, memberId, activityId } = await req.json();
  if (!uid || typeof uid !== "string" || !memberId || typeof memberId !== "string" || typeof activityId !== "string") {
    return NextResponse.json({ error: "uid, memberId and activityId are required" }, { status: 400 });
  }
  const activity = await prisma.pppActivity.findUnique({ where: { id: activityId }, select: { associationId: true, joint: true } });
  if (!activity || !(await activityVisible(activityId, posScope(user)))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
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

  // The person must be able to pay here; then the card goes on their Stress
  // membership if they have one (kiosk) — it works for all their memberships.
  const result = await resolvePayer(memberId, activity);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const holderId = await cardHolderFor(memberId);
  if (!holderId) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  await prisma.card.create({
    data: { uid: normalised, memberId: holderId, name: "Linked at the bar" },
  });

  const { payer } = result;
  return NextResponse.json({
    memberId: payer.id,
    firstName: payer.firstName,
    lastName: payer.lastName,
    associationId: payer.associationId,
    roles: payer.roles,
  });
}
