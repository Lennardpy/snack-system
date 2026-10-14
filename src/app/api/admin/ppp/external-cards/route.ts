import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { normalizeUid } from "@/lib/card";

// External cards: bar cards not linked to a member (see ExternalCard in the schema).
// GET lists them; POST { uid, name } adds one.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
