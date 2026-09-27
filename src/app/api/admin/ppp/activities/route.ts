import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { sumLineDiscounts } from "@/lib/roles";
import { sbzCostInclCents } from "@/lib/sbz";

// Full activity list for the admin panel: order counts, revenue (+ saved SumUp), cost of goods
// (from entered SBZ usage), and the discount given (specials-only + total) per
// activity. OPEN ones first.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [activities, invoices, usage] = await Promise.all([
    prisma.pppActivity.findMany({
      orderBy: { date: "desc" },
      include: { sumup: { select: { revenueCents: true } } },
    }),
    prisma.pppInvoice.findMany({
      select: {
        activityId: true,
        totalCents: true,
        lines: {
          select: {
            quantity: true,
            unitCents: true,
            listCents: true,
            specialCents: true,
            product: { select: { price: true } },
          },
        },
      },
    }),
    prisma.pppActivityUsage.findMany({ select: { activityId: true, sbzKey: true, quantity: true } }),
  ]);

  type Agg = { orders: number; revenue: number; specials: number; total: number };
  const agg = new Map<string, Agg>();
  for (const inv of invoices) {
    const e = agg.get(inv.activityId) ?? { orders: 0, revenue: 0, specials: 0, total: 0 };
    e.orders += 1;
    e.revenue += inv.totalCents;
    const d = sumLineDiscounts(inv.lines);
    e.specials += d.specialsCents;
    e.total += d.totalCents;
    agg.set(inv.activityId, e);
  }

  // Cost of goods per activity from the entered SBZ usage.
  const cogs = new Map<string, number>();
  for (const u of usage) {
    cogs.set(u.activityId, (cogs.get(u.activityId) ?? 0) + sbzCostInclCents(u.sbzKey, u.quantity));
  }

  const result = activities
    .map((a) => {
      const e = agg.get(a.id);
      return {
        id: a.id,
        name: a.name,
        status: a.status,
        date: a.date,
        orderCount: e?.orders ?? 0,
        revenueCents: e?.revenue ?? 0,
        specialsDiscountCents: e?.specials ?? 0,
        totalDiscountCents: e?.total ?? 0,
        cogsInclCents: cogs.get(a.id) ?? 0,
        // Saved SumUp card revenue (null = not saved yet; the page fetches it).
        sumupCents: a.sumup?.revenueCents ?? null,
      };
    })
    // OPEN before CLOSED, preserving date order within each group.
    .sort((a, b) => Number(a.status === "CLOSED") - Number(b.status === "CLOSED"));

  return NextResponse.json({ activities: result });
}
