import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loginAssociations, requireMember } from "@/lib/member-auth";
import { memberInvoices } from "@/lib/member-invoice";

// GET /api/user/me — the member portal: who's signed in, what they still owe (not
// billed yet), spending per month, their purchases and their invoices — across all
// of the person's memberships. Signed out: { signedIn: false, providers } (the
// associations offering "Log in with Congressus").
export async function GET() {
  const ctx = await requireMember();
  if (!ctx) return NextResponse.json({ signedIn: false, providers: loginAssociations() });

  const ids = ctx.memberships.map((m) => m.id);
  const assocOf = new Map(ctx.memberships.map((m) => [m.id, m.associationId]));
  const counted = { in: ["CONFIRMED" as const, "EXPORTING" as const, "EXPORTED" as const] };
  const [ppp, sss, invoices] = await Promise.all([
    prisma.pppInvoice.findMany({
      where: { memberId: { in: ids }, status: counted },
      orderBy: { confirmedAt: "desc" },
      select: {
        id: true,
        memberId: true,
        status: true,
        totalCents: true,
        confirmedAt: true,
        activity: { select: { name: true } },
        lines: { select: { quantity: true, unitCents: true, product: { select: { name: true } } } },
      },
    }),
    prisma.saleInvoice.findMany({
      where: { memberId: { in: ids }, status: counted },
      orderBy: { confirmedAt: "desc" },
      select: {
        id: true,
        memberId: true,
        status: true,
        totalCents: true,
        confirmedAt: true,
        createdAt: true,
        lines: { select: { quantity: true, unitCents: true, product: { select: { name: true } } } },
      },
    }),
    memberInvoices(ids),
  ]);

  const purchases = [
    ...ppp.map((o) => ({
      id: o.id,
      association: assocOf.get(o.memberId)!,
      where: o.activity.name,
      at: o.confirmedAt.toISOString(),
      totalCents: o.totalCents,
      billed: o.status === "EXPORTED",
      lines: o.lines.map((l) => ({ name: l.product.name, quantity: l.quantity, unitCents: l.unitCents })),
    })),
    ...sss.map((o) => ({
      id: o.id,
      association: assocOf.get(o.memberId)!,
      where: "Snack kiosk",
      at: (o.confirmedAt ?? o.createdAt).toISOString(),
      totalCents: o.totalCents,
      billed: o.status === "EXPORTED",
      lines: o.lines.map((l) => ({ name: l.product.name, quantity: l.quantity, unitCents: l.unitCents })),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  // Spending per calendar month (Amsterdam), last 12 months with purchases.
  const months = new Map<string, number>();
  for (const p of purchases) {
    const key = new Date(p.at).toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", timeZone: "Europe/Amsterdam" });
    months.set(key, (months.get(key) ?? 0) + p.totalCents);
  }

  return NextResponse.json({
    signedIn: true,
    member: { firstName: ctx.member.firstName, lastName: ctx.member.lastName, email: ctx.member.email },
    memberships: ctx.memberships.map((m) => ({ association: m.associationId, active: m.active })),
    unbilledCents: purchases.filter((p) => !p.billed).reduce((s, p) => s + p.totalCents, 0),
    months: [...months.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 12)
      .map(([month, cents]) => ({ month, cents })),
    purchases: purchases.slice(0, 200),
    invoices,
  });
}
