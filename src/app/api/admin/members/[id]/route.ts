import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// GET /api/admin/members/[id] — the member dashboard: cards (with UIDs), roles,
// SSS + PPP spend totals, the open (confirmed, not yet exported) amount, and the
// full purchase history of both systems, newest first.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const member = await prisma.member.findUnique({
    where: { id },
    include: {
      cards: { orderBy: { createdAt: "asc" } },
      roles: { select: { id: true, name: true, discountPercent: true, discountCents: true, ownDrinkOnly: true, color: true } },
    },
  });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const [sss, ppp] = await Promise.all([
    prisma.saleInvoice.findMany({
      where: { memberId: id, status: { in: ["CONFIRMED", "EXPORTING", "EXPORTED"] } },
      include: { lines: { include: { product: { select: { name: true } } } } },
      orderBy: { confirmedAt: "desc" },
    }),
    prisma.pppInvoice.findMany({
      where: { memberId: id, status: { in: ["CONFIRMED", "EXPORTING", "EXPORTED"] } },
      include: {
        activity: { select: { name: true } },
        lines: { include: { product: { select: { name: true } } } },
      },
      orderBy: { confirmedAt: "desc" },
    }),
  ]);

  const totals = (invs: { status: string; totalCents: number }[]) => ({
    spentCents: invs.reduce((s, i) => s + i.totalCents, 0),
    openCents: invs.filter((i) => i.status !== "EXPORTED").reduce((s, i) => s + i.totalCents, 0),
    orders: invs.length,
  });

  const purchases = [
    ...sss.map((i) => ({
      id: i.id,
      system: "SSS" as const,
      at: (i.confirmedAt ?? i.createdAt).toISOString(),
      totalCents: i.totalCents,
      exported: i.status === "EXPORTED",
      context: null as string | null,
      lines: i.lines.map((l) => ({ name: l.product.name, quantity: l.quantity, unitCents: l.unitCents })),
    })),
    ...ppp.map((i) => ({
      id: i.id,
      system: "PPP" as const,
      at: i.confirmedAt.toISOString(),
      totalCents: i.totalCents,
      exported: i.status === "EXPORTED",
      context: i.activity.name,
      lines: i.lines.map((l) => ({ name: l.product.name, quantity: l.quantity, unitCents: l.unitCents })),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return NextResponse.json({
    member: {
      id: member.id,
      congressusId: member.congressusId,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
      active: member.active,
      roles: member.roles,
      cards: member.cards.map((c) => ({ id: c.id, uid: c.uid, name: c.name, createdAt: c.createdAt.toISOString() })),
    },
    sss: totals(sss),
    ppp: totals(ppp),
    purchases,
  });
}

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
