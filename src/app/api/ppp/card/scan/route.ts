import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { normalizeUid } from "@/lib/card";
import { requireBartender } from "@/lib/auth";
import { resolvePayer } from "@/lib/memberships";
import { activityVisible } from "@/lib/scope-db";
import { posScope } from "@/lib/scope";

// Bartender-operated scan at the bar POS. Resolves a tapped card UID to a member
// so the bartender can confirm who they are charging.
//
// This reuses the EXACT same linked-card data as the snack kiosk: it looks up the
// shared `Card` table by normalised UID. A card linked at the kiosk works here
// with no re-registration. PPP has no card/member tables of its own.
//
// Unlike the public `POST /api/card/scan`, this route is behind requireBartender()
// (the bar POS is not a public page), so it may safely return the member's name.
export async function POST(req: NextRequest) {
  const user = await requireBartender();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cheap defence against a stuck/looping reader hammering the endpoint.
  if (!rateLimit(`ppp-scan:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { uid, activityId } = await req.json();

  if (!uid || typeof uid !== "string" || typeof activityId !== "string") {
    return NextResponse.json({ error: "uid and activityId are required" }, { status: 400 });
  }
  const activity = await prisma.pppActivity.findUnique({ where: { id: activityId }, select: { associationId: true, joint: true } });
  if (!activity || !(await activityVisible(activityId, posScope(user)))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const card = await prisma.card.findUnique({ where: { uid: normalizeUid(uid) }, select: { memberId: true } });

  if (!card) {
    // An external card (not linked to a member): its drinks go on this borrel's
    // external tab, invoiced separately.
    const external = await prisma.externalCard.findUnique({ where: { uid: normalizeUid(uid) } });
    if (external) {
      return NextResponse.json({ external: true, cardId: external.id, name: external.name });
    }
    // Not an error at the bar: the bartender can link this card to a member on
    // the spot. Return the normalised UID so the POS can offer to link it.
    return NextResponse.json({ unlinked: true, uid: normalizeUid(uid) });
  }

  // The card belongs to a person; charge the membership that pays at this borrel
  // (Stress at a joint borrel for someone in both associations).
  const result = await resolvePayer(card.memberId, activity);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const { payer } = result;

  // Return the payer's roles (their own association's); the POS computes the
  // per-product discount from them, so it can show the real total before confirming.
  return NextResponse.json({
    memberId: payer.id,
    firstName: payer.firstName,
    lastName: payer.lastName,
    associationId: payer.associationId,
    roles: payer.roles,
  });
}
