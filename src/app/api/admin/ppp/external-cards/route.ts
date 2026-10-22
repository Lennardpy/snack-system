import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { isStressSide } from "@/lib/scope";
import { normalizeUid } from "@/lib/card";

// External cards: bar cards not linked to a member (see ExternalCard in the schema).
// GET lists them; POST { uid, name } adds one.
export async function GET() {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) {
    return NextResponse.json({ error: "Not available for this association" }, { status: 403 });
  }

  const cards = await prisma.externalCard.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      tabs: {
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, activity: { select: { id: true, name: true, date: true } } },
      },
    },
  });
  return NextResponse.json({ cards });
}

export async function POST(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) {
    return NextResponse.json({ error: "Not available for this association" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const uid = typeof body.uid === "string" ? normalizeUid(body.uid) : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!uid || !name) return NextResponse.json({ error: "Card UID and name are required" }, { status: 400 });

  const linked = await prisma.card.findUnique({
    where: { uid },
    include: { member: { select: { firstName: true, lastName: true } } },
  });
  if (linked) {
    return NextResponse.json(
      { error: `This card is linked to ${linked.member.firstName} ${linked.member.lastName}. Unlink it on their member page first.` },
      { status: 409 }
    );
  }
  if (await prisma.externalCard.findUnique({ where: { uid } })) {
    return NextResponse.json({ error: "This card is already an external card" }, { status: 409 });
  }
  const card = await prisma.externalCard.create({ data: { uid, name } });
  return NextResponse.json({ card });
}
