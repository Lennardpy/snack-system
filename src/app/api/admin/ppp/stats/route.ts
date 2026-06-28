import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// GET /api/admin/ppp/stats?range=7d|30d|90d|365d|all
// PPP (bar) overview: financials, top borrels, top drinkers (by drinks), top drinks.
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const range = req.nextUrl.searchParams.get("range") ?? "90d";
  const days = range === "all" ? null : parseInt(range.replace("d", ""), 10) || 90;
  const from = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

  const invoices = await prisma.pppInvoice.findMany({
    where: {
      status: { in: ["CONFIRMED", "EXPORTED"] },
      ...(from ? { confirmedAt: { gte: from } } : {}),
    },
    include: {
      member: { select: { firstName: true, lastName: true } },
      activity: { select: { id: true, name: true } },
      lines: { include: { product: { select: { name: true } } } },
    },
    orderBy: { confirmedAt: "asc" },
  });

  let revenueCents = 0;
  let drinksSold = 0;
  const orderCount = invoices.length;

  const borrelMap = new Map<string, { name: string; revenueCents: number; drinks: number; orders: number }>();
  const drinkerMap = new Map<string, { name: string; drinks: number; revenueCents: number }>();
  const drinkMap = new Map<string, { name: string; quantity: number; revenueCents: number }>();

  for (const inv of invoices) {
    revenueCents += inv.totalCents;
    const drinksInOrder = inv.lines.reduce((s, l) => s + l.quantity, 0);
    drinksSold += drinksInOrder;

    // Borrel (activity)
    const b = borrelMap.get(inv.activityId) ?? { name: inv.activity.name, revenueCents: 0, drinks: 0, orders: 0 };
    b.revenueCents += inv.totalCents;
    b.drinks += drinksInOrder;
    b.orders += 1;
    borrelMap.set(inv.activityId, b);

    // Drinker (member)
    const d = drinkerMap.get(inv.memberId) ?? {
      name: `${inv.member.firstName} ${inv.member.lastName}`.trim(),
      drinks: 0,
      revenueCents: 0,
    };
    d.drinks += drinksInOrder;
    d.revenueCents += inv.totalCents;
    drinkerMap.set(inv.memberId, d);

    // Drinks (product)
    for (const line of inv.lines) {
      const p = drinkMap.get(line.product.name) ?? { name: line.product.name, quantity: 0, revenueCents: 0 };
      p.quantity += line.quantity;
      p.revenueCents += line.quantity * line.unitCents;
      drinkMap.set(line.product.name, p);
    }
  }

  const topBorrels = [...borrelMap.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 8);

  const topDrinkers = [...drinkerMap.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.drinks - a.drinks)
    .slice(0, 10);

  const topDrinks = [...drinkMap.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 8);

  return NextResponse.json({
    range,
    revenueCents,
    drinksSold,
    orderCount,
    borrelCount: borrelMap.size,
    activeDrinkers: drinkerMap.size,
    avgOrderCents: orderCount > 0 ? Math.round(revenueCents / orderCount) : 0,
    topBorrels,
    topDrinkers,
    topDrinks,
  });
}
