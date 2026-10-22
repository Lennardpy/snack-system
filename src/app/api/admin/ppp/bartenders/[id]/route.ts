import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { userWhere } from "@/lib/scope";

// Link / unlink a bartender to a member (so they can log in by scanning a card).
// Body: { memberId: string }  to link, or { memberId: null } to unlink.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { memberId } = await req.json();

  const user = await prisma.user.findFirst({ where: { id, ...userWhere(ctx.scope) } });
  if (!user || user.role !== "BARTENDER") {
    return NextResponse.json({ error: "Bartender not found" }, { status: 404 });
  }

  if (memberId === null) {
    await prisma.user.update({ where: { id }, data: { memberId: null } });
    return NextResponse.json({ ok: true, member: null });
  }

  if (typeof memberId !== "string") {
    return NextResponse.json({ error: "memberId must be a string or null" }, { status: 400 });
  }

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: { cards: { select: { id: true } } },
  });
  // A bartender can only be linked to a member of their own association.
  if (!member || (user.associationId && member.associationId !== user.associationId)) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // User.memberId is unique — make sure this member isn't already linked elsewhere.
  const clash = await prisma.user.findUnique({ where: { memberId } });
  if (clash && clash.id !== id) {
    return NextResponse.json({ error: "That member is already linked to another account" }, { status: 409 });
  }

  await prisma.user.update({ where: { id }, data: { memberId } });
  return NextResponse.json({
    ok: true,
    member: {
      id: member.id,
      name: `${member.firstName} ${member.lastName}`.trim(),
      email: member.email,
      cardCount: member.cards.length,
    },
  });
}

// Delete a bartender account (cascades sessions + invite token).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const user = await prisma.user.findFirst({ where: { id, ...userWhere(ctx.scope) } });
  if (!user || user.role !== "BARTENDER") {
    return NextResponse.json({ error: "Bartender not found" }, { status: 404 });
  }

  // Sessions cascade (onDelete: Cascade); the invite token cascades too.
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
