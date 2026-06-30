import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { sumLineDiscounts } from "@/lib/roles";

// Full activity list for the admin panel: order counts, revenue, and the discount
// given (specials-only + total) per activity. OPEN ones first.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [activities, invoices] = await Promise.all([
    prisma.pppActivity.findMany({ orderBy: { date: "desc" } }),
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
      };
    })
    // OPEN before CLOSED, preserving date order within each group.
    .sort((a, b) => Number(a.status === "CLOSED") - Number(b.status === "CLOSED"));

  return NextResponse.json({ activities: result });
}
