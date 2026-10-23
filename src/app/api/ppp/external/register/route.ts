import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeUid } from "@/lib/card";
import { requireBartender } from "@/lib/auth";
import { isStressSide, posScope } from "@/lib/scope";

// Make an unrecognised card an EXTERNAL card from the bar POS (e.g. handed to an
// external party). It is not linked to any member: its drinks go on the borrel's
// external tab. Body: { uid, name? } — name defaults to "External card N".
// Returns { cardId, name } so the POS can charge it right away.
export async function POST(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // External cards are Stress's: not for staff working only for Dimensie.
  if (!isStressSide(posScope(user))) {
    return NextResponse.json({ error: "External cards are only used at Stress borrels" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.uid || typeof body.uid !== "string") {
    return NextResponse.json({ error: "uid is required" }, { status: 400 });
  }
  const uid = normalizeUid(body.uid);

  const linked = await prisma.card.findUnique({
    where: { uid },
    include: { member: { select: { firstName: true, lastName: true } } },
  });
  if (linked) {
    return NextResponse.json(
      { error: `Card is already linked to ${linked.member.firstName} ${linked.member.lastName}` },
      { status: 409 }
    );
  }
  const existing = await prisma.externalCard.findUnique({ where: { uid } });
  if (existing) return NextResponse.json({ cardId: existing.id, name: existing.name });

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 60)
      : `External card ${(await prisma.externalCard.count()) + 1}`;
  const card = await prisma.externalCard.create({ data: { uid, name } });
  return NextResponse.json({ cardId: card.id, name: card.name });
}
