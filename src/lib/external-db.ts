import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";
import { externalBreakdown, type ExternalBreakdown, type ExternalPriceLevel } from "./external";

// External tabs (with their orders and the priced breakdown at the tab's level).
export async function loadExternalTabs(where: { activityId?: string; id?: string }) {
  const tabs = await prisma.pppExternalTab.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: {
      activity: { select: { id: true, name: true, date: true } },
      card: { select: { id: true, name: true, uid: true } },
      orders: {
        orderBy: { createdAt: "asc" },
        include: {
          createdBy: { select: { email: true, member: { select: { firstName: true, lastName: true } } } },
          lines: { include: { product: { select: { name: true } } } },
        },
      },
    },
  });
  return tabs.map((t) => {
    const lines = t.orders.flatMap((o) =>
      o.lines.map((l) => ({
        productId: l.productId,
        name: l.product.name,
        quantity: l.quantity,
        unitCents: l.unitCents,
        vatRate: l.vatRate,
      }))
    );
    const breakdown: ExternalBreakdown = externalBreakdown(lines, t.priceLevel as ExternalPriceLevel);
    const internalInclCents = externalBreakdown(lines, "INTERNAL").totalInclCents;
    return {
      id: t.id,
      title: t.title,
      priceLevel: t.priceLevel as ExternalPriceLevel,
      cardName: t.card?.name ?? t.cardName,
      cardUid: t.card?.uid ?? null,
      activity: t.activity,
      breakdown,
      // Split of the total: the internal-price part counts as borrel revenue (P/L);
      // the markup above it (Internal + 10% / Tussen / External) is AB profit.
      internalInclCents,
      abProfitCents: breakdown.totalInclCents - internalInclCents,
      orders: t.orders.map((o) => ({
        id: o.id,
        createdAt: o.createdAt,
        by: o.createdBy
          ? o.createdBy.member
            ? `${o.createdBy.member.firstName} ${o.createdBy.member.lastName}`
            : o.createdBy.email
          : null,
        lines: o.lines.map((l) => ({ name: l.product.name, quantity: l.quantity, unitCents: l.unitCents })),
      })),
    };
  });
}
export type ExternalTabView = Awaited<ReturnType<typeof loadExternalTabs>>[number];

// External tabs per activity, split (incl. VAT):
//   • internalCents — the drinks at the internal selling price: borrel revenue,
//     counted in the profit/loss like member charges;
//   • abProfitCents — the markup of the tab's price level on top of that
//     (Internal + 10% / Tussen / External): AB profit, kept OUT of the profit/loss.
export interface ExternalSplit {
  internalCents: number;
  abProfitCents: number;
}
export async function externalSplitByActivity(
  where: Prisma.PppExternalTabWhereInput = {}
): Promise<Map<string, ExternalSplit>> {
  const tabs = await prisma.pppExternalTab.findMany({
    where,
    select: {
      activityId: true,
      priceLevel: true,
      orders: { select: { lines: { select: { productId: true, quantity: true, unitCents: true, vatRate: true } } } },
    },
  });
  const m = new Map<string, ExternalSplit>();
  for (const t of tabs) {
    const lines = t.orders.flatMap((o) => o.lines.map((l) => ({ ...l, name: "" })));
    const internal = externalBreakdown(lines, "INTERNAL").totalInclCents;
    const atLevel = externalBreakdown(lines, t.priceLevel as ExternalPriceLevel).totalInclCents;
    const e = m.get(t.activityId) ?? { internalCents: 0, abProfitCents: 0 };
    e.internalCents += internal;
    e.abProfitCents += atLevel - internal;
    m.set(t.activityId, e);
  }
  return m;
}

export const sumSplits = (m: Map<string, ExternalSplit>): ExternalSplit =>
  [...m.values()].reduce(
    (s, e) => ({ internalCents: s.internalCents + e.internalCents, abProfitCents: s.abProfitCents + e.abProfitCents }),
    { internalCents: 0, abProfitCents: 0 }
  );
