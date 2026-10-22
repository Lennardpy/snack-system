import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMemberAdmin } from "@/lib/auth";
import { inScope } from "@/lib/scope";
import { rehomeCards, cardsByPerson } from "@/lib/memberships";

// GET /api/admin/members/[id] — the member dashboard: cards (with UIDs), roles,
// SSS + PPP spend totals, the open (confirmed, not yet exported) amount, and the
// full purchase history of both systems, newest first.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMemberAdmin();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const member = await prisma.member.findUnique({
    where: { id },
    include: {
      roles: { select: { id: true, name: true, discountPercent: true, discountCents: true, ownDrinkOnly: true, color: true } },
    },
  });
  if (!member || !inScope(ctx.scope, member.associationId)) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

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
      associationId: member.associationId,
      congressusId: member.congressusId,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
      active: member.active,
      roles: member.roles,
      // The person's cards, on whichever of their memberships they're stored.
      cards: ((await cardsByPerson()).get(member.email.toLowerCase()) ?? []).map((c) => ({
        id: c.id,
        uid: c.uid,
        name: c.name,
        createdAt: c.createdAt.toISOString(),
      })),
    },
    sss: totals(sss),
    ppp: totals(ppp),
    purchases,
  });
}

// DELETE /api/admin/members/[id] — delete a member.
//   • Blocked while they have unbilled orders (SSS or PPP, CONFIRMED/EXPORTING):
//     export or delete those first, so no money is lost.
//   • No purchase history at all → removed completely (cards, sessions too).
//   • Only exported history → ANONYMISED instead: name/email erased, cards,
//     sessions, roles and any bartender-account link removed, detached from
//     Congressus, deletedAt set. The row stays so past orders and every revenue /
//     P/L figure remain correct; they show as "Deleted member".
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMemberAdmin();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const member = await prisma.member.findUnique({
    where: { id },
    select: { id: true, email: true, deletedAt: true, associationId: true },
  });
  if (!member || !inScope(ctx.scope, member.associationId)) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (member.deletedAt) return NextResponse.json({ error: "Member is already deleted" }, { status: 409 });

  const unbilled = { status: { in: ["CONFIRMED" as const, "EXPORTING" as const] }, memberId: id };
  const [openSss, openPpp, exportedSss, exportedPpp] = await Promise.all([
    prisma.saleInvoice.count({ where: unbilled }),
    prisma.pppInvoice.count({ where: unbilled }),
    prisma.saleInvoice.count({ where: { memberId: id, status: "EXPORTED" } }),
    prisma.pppInvoice.count({ where: { memberId: id, status: "EXPORTED" } }),
  ]);
  if (openSss + openPpp > 0) {
    return NextResponse.json(
      {
        error:
          `Cannot delete: ${openSss + openPpp} order(s) are not billed yet ` +
          `(${openSss} snack, ${openPpp} drink). Export them to Congressus (or delete them) first.`,
      },
      { status: 409 }
    );
  }

  // Abandoned kiosk carts (CONCEPT) are never billed — always removed.
  const concept = { memberId: id, status: "CONCEPT" as const };
  // Someone also in the other association keeps their card there.
  await rehomeCards(id);
  const cleanup = [
    prisma.invoiceLine.deleteMany({ where: { invoice: concept } }),
    prisma.saleInvoice.deleteMany({ where: concept }),
    prisma.card.deleteMany({ where: { memberId: id } }), // after rehomeCards: only cards with nowhere to go
    prisma.shopSession.deleteMany({ where: { memberId: id } }),
    prisma.cardRegistration.deleteMany({ where: { email: member.email } }),
    prisma.user.updateMany({ where: { memberId: id }, data: { memberId: null } }),
  ];

  if (exportedSss + exportedPpp === 0) {
    await prisma.$transaction([...cleanup, prisma.member.delete({ where: { id } })]);
    return NextResponse.json({ ok: true, anonymised: false });
  }

  await prisma.$transaction([
    ...cleanup,
    prisma.member.update({
      where: { id },
      data: {
        firstName: "Deleted",
        lastName: "member",
        email: `deleted-${id}@deleted.invalid`,
        active: false,
        congressusId: null,
        deletedAt: new Date(),
        roles: { set: [] },
      },
    }),
  ]);
  return NextResponse.json({ ok: true, anonymised: true, exportedOrders: exportedSss + exportedPpp });
}
