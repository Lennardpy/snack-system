import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { uid } = await req.json();
  if (!uid) return NextResponse.json({ error: "Missing uid" }, { status: 400 });

  const normalised = uid.trim().toUpperCase();

  // Check if card is already registered to someone else
  const existing = await prisma.card.findUnique({ where: { uid: normalised } });
  if (existing && existing.memberId !== session.user.memberId) {
    return NextResponse.json({ error: "Card already registered to another member" }, { status: 409 });
  }

  if (!session.user.memberId) {
    return NextResponse.json({ error: "No member account linked to your login" }, { status: 400 });
  }

  await prisma.card.upsert({
    where: { uid: normalised },
    create: { uid: normalised, memberId: session.user.memberId },
    update: { memberId: session.user.memberId },
  });

  return NextResponse.json({ ok: true });
}
