import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMemberAdmin } from "@/lib/auth";
import { memberWhere } from "@/lib/scope";

// DELETE /api/admin/members/[id]/cards/[cardId] — unlink one card from a member
// (e.g. a lost card). Only the card is removed; the member, their invoices and
// history stay. The UID becomes unregistered and can be linked again later.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  const ctx = await requireMemberAdmin();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, cardId } = await params;
  // The member must be in this login's scope; the card may be stored on any of
  // that person's memberships (cards belong to the person, not one association).
  const member = await prisma.member.findFirst({ where: { id, ...memberWhere(ctx.scope) }, select: { email: true } });
  if (!member) return NextResponse.json({ error: "Card not found for this member" }, { status: 404 });
  const { count } = await prisma.card.deleteMany({
    where: { id: cardId, member: { email: { equals: member.email, mode: "insensitive" } } },
  });
  if (count === 0) return NextResponse.json({ error: "Card not found for this member" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
