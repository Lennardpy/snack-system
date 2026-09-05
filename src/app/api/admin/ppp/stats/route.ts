import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { roleDiscountAmount } from "@/lib/roles";

// GET /api/admin/ppp/stats?range=7d|30d|90d|365d|all|since_export
// PPP (bar) overview: financials, top borrels, top drinkers (by drinks), top drinks.
// `since_export` = the still-unbilled orders (status CONFIRMED, i.e. everything
// since the last Congressus export) so the admin can see what money is still to come.
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const range = req.nextUrl.searchParams.get("range") ?? "90d";
  const sinceExport = range === "since_export";

  let from: Date | null = null;
  let lastExportAt: Date | null = null;
  if (sinceExport) {
    const last = await prisma.pppInvoice.findFirst({
      where: { exportedAt: { not: null } },
      orderBy: { exportedAt: "desc" },
      select: { exportedAt: true },
    });
    lastExportAt = last?.exportedAt ?? null;
  } else {
    const days = range === "all" ? null : parseInt(range.replace("d", ""), 10) || 90;
    from = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
  }

  const invoices = await prisma.pppInvoice.findMany({
    where: sinceExport
      ? { status: "CONFIRMED" } // unbilled = still to come
      : {
          status: { in: ["CONFIRMED", "EXPORTED"] },
          ...(from ? { confirmedAt: { gte: from } } : {}),
        },
    include: {
      member: {
        select: {
          firstName: true,
          lastName: true,
          roles: { select: { name: true, discountPercent: true, discountCents: true } },
        },
      },
      activity: { select: { id: true, name: true } },
      lines: { include: { product: { select: { name: true } } } },
    },
    orderBy: { confirmedAt: "asc" },
  });

  let revenueCents = 0;
  let drinksSold = 0;
  // What the association pays for bartenders' free drinks (comped bartender-free
  // lines, valued at their list price).
  let bartenderCostCents = 0;
  let bartenderDrinks = 0;
  // Cost of role-based free/discounted drinks, split per role (e.g. Board, PilsCie):
  // each line's discount is attributed to the role that actually granted it.
  const roleCostMap = new Map<string, { costCents: number; drinks: number }>();
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
      if (line.bartenderFree) {
        bartenderCostCents += (line.listCents ?? 0) * line.quantity;
        bartenderDrinks += line.quantity;
        continue; // bartender comps are reported separately, not as a role cost
      }
      // Attribute the role discount on this line to the role that granted it.
      const roles = inv.member.roles;
      if (roles.length === 0) continue;
      const preRole = line.specialCents ?? line.listCents; // price before role discount
      if (preRole == null) continue;
      const ignoreFixed = line.specialCents != null; // on a special, only % roles apply
      let bestAmt = 0;
      let bestRole = "";
      for (const r of roles) {
        const amt = roleDiscountAmount(preRole, r, ignoreFixed);
        if (amt > bestAmt) {
          bestAmt = amt;
          bestRole = r.name;
        }
      }
      if (bestAmt > 0 && bestRole) {
        const e = roleCostMap.get(bestRole) ?? { costCents: 0, drinks: 0 };
        e.costCents += bestAmt * line.quantity;
        e.drinks += line.quantity;
        roleCostMap.set(bestRole, e);
      }
    }
  }

  const roleCosts = [...roleCostMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.costCents - a.costCents);

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
    lastExportAt: lastExportAt ? lastExportAt.toISOString() : null,
    revenueCents,
    drinksSold,
    orderCount,
    borrelCount: borrelMap.size,
    activeDrinkers: drinkerMap.size,
    avgOrderCents: orderCount > 0 ? Math.round(revenueCents / orderCount) : 0,
    bartenderCostCents,
    bartenderDrinks,
    roleCosts,
    topBorrels,
    topDrinkers,
    topDrinks,
  });
}
