import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { normalizeUid } from "@/lib/card";
import { requireBartender } from "@/lib/auth";
import { externalTabUsedCents } from "@/lib/external-db";

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

  // activityId (optional): for an external card, report its spending at this borrel.
  const { uid, activityId } = await req.json();

  if (!uid || typeof uid !== "string") {
    return NextResponse.json({ error: "Missing uid" }, { status: 400 });
  }

  const card = await prisma.card.findUnique({
    where: { uid: normalizeUid(uid) },
    include: {
      member: {
        include: {
          roles: {
            select: { name: true, discountPercent: true, discountCents: true, ownDrinkOnly: true, color: true },
          },
        },
      },
    },
  });

  if (!card) {
    // An external card (not linked to a member): its drinks go on this borrel's
    // external tab, invoiced separately.
    const external = await prisma.externalCard.findUnique({ where: { uid: normalizeUid(uid) } });
    if (external) {
      return NextResponse.json({
        external: true,
        cardId: external.id,
        name: external.name,
        limitCents: external.limitCents,
        usedCents: typeof activityId === "string" ? await externalTabUsedCents(external.id, activityId) : 0,
      });
    }
    // Not an error at the bar: the bartender can link this card to a member on
    // the spot. Return the normalised UID so the POS can offer to link it.
    return NextResponse.json({ unlinked: true, uid: normalizeUid(uid) });
  }

  if (!card.member.active) {
    return NextResponse.json({ error: "Member inactive" }, { status: 403 });
  }

  // Return the member's roles; the POS computes the per-product discount from them
  // (percent and/or fixed cents), so it can show the real total before confirming.
  return NextResponse.json({
    memberId: card.member.id,
    firstName: card.member.firstName,
    lastName: card.member.lastName,
    roles: card.member.roles,
  });
}
