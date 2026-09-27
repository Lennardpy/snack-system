import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// DELETE /api/admin/members/[id]/cards/[cardId] — unlink one card from a member
// (e.g. a lost card). Only the card is removed; the member, their invoices and
// history stay. The UID becomes unregistered and can be linked again later.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; cardId: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, cardId } = await params;
  const { count } = await prisma.card.deleteMany({ where: { id: cardId, memberId: id } });
  if (count === 0) return NextResponse.json({ error: "Card not found for this member" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
