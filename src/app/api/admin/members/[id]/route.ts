import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// DELETE /api/admin/members/[id] — remove a member and their cards/sessions.
// Invoices are preserved for accounting; we block deletion if any exist.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const member = await prisma.member.findUnique({
    where: { id },
    include: { _count: { select: { invoices: true } } },
  });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  if (member._count.invoices > 0) {
    return NextResponse.json(
      { error: `Cannot delete: member has ${member._count.invoices} invoice(s). Delete those first.` },
      { status: 409 }
    );
  }

  // Remove dependent rows first (no cascade in schema).
  await prisma.$transaction([
    prisma.card.deleteMany({ where: { memberId: id } }),
    prisma.shopSession.deleteMany({ where: { memberId: id } }),
    prisma.member.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
