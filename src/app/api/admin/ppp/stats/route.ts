import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { attributeRoleDiscount } from "@/lib/roles";
import { sbzCostInclCents } from "@/lib/sbz";
import { loadSbzLists, sbzCatalogAt } from "@/lib/sbz-db";
import { costedActivityIds, resolvePppRange } from "@/lib/ppp-pl";
import { externalSplitByActivity, sumSplits } from "@/lib/external-db";
import { activityWhere, pppInvoiceWhere } from "@/lib/scope";

// GET /api/admin/ppp/stats?range=7d|30d|90d|365d|all|since_export
// PPP (bar) overview: financials, top borrels, top drinkers (by drinks), top drinks.
// `since_export` = the still-unbilled orders (status CONFIRMED, i.e. everything
// since the last Congressus export) so the admin can see what money is still to come.
export async function GET(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const range = req.nextUrl.searchParams.get("range") ?? "90d";
  const sinceExport = range === "since_export";

  const resolved = await resolvePppRange(range);
  const lastExportAt = resolved.lastExportAt;
  // Order-date filter for the general stats (since_export filters by status instead).
  const from = sinceExport ? null : resolved.from;

  // Only the login's association: orders at its borrels or by its members.
  const invoices = await prisma.pppInvoice.findMany({
    where: sinceExport
      ? { status: { in: ["CONFIRMED", "EXPORTING"] }, ...pppInvoiceWhere(ctx.scope) } // unbilled = still to come
      : {
          status: { in: ["CONFIRMED", "EXPORTING", "EXPORTED"] },
          ...(from ? { confirmedAt: { gte: from } } : {}),
          ...pppInvoiceWhere(ctx.scope),
        },
    include: {
      member: {
        select: {
          firstName: true,
          lastName: true,
          roles: { select: { name: true, discountPercent: true, discountCents: true, ownDrinkOnly: true } },
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
      const attr = attributeRoleDiscount(preRole, line.unitCents, roles, ignoreFixed);
      if (attr) {
        const e = roleCostMap.get(attr.role) ?? { costCents: 0, drinks: 0 };
        e.costCents += attr.amountCents * line.quantity;
        e.drinks += line.quantity;
        roleCostMap.set(attr.role, e);
      }
    }
  }

  const roleCosts = [...roleCostMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.costCents - a.costCents);

  // Profit/loss covers only borrels in the range with cost of goods uploaded, so
  // income and costs describe the same borrels. Member income = all their orders.
  const plIds = await costedActivityIds(resolved.from, ctx.scope);
  const [usage, plIncome, sbzLists, plExternal, rangeExternal] = await Promise.all([
    prisma.pppActivityUsage.findMany({
      where: { activityId: { in: plIds } },
      select: { sbzKey: true, quantity: true, activity: { select: { date: true } } },
    }),
    prisma.pppInvoice.aggregate({
      where: { activityId: { in: plIds }, status: { in: ["CONFIRMED", "EXPORTING", "EXPORTED"] } },
      _sum: { totalCents: true },
    }),
    loadSbzLists(),
    externalSplitByActivity({ activityId: { in: plIds } }),
    // AB profit: the markup on external-card tabs at borrels in the range (all of
    // them, costs uploaded or not) — kept out of the profit/loss.
    externalSplitByActivity({
      activity: { ...activityWhere(ctx.scope), ...(resolved.from ? { date: { gte: resolved.from } } : {}) },
    }),
  ]);
  // Each borrel's usage is priced with the SBZ list valid on its date.
  let cogsInclCents = 0;
  for (const u of usage) {
    cogsInclCents += sbzCostInclCents(sbzCatalogAt(sbzLists, u.activity.date), u.sbzKey, u.quantity);
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
    lastExportAt: lastExportAt ? lastExportAt.toISOString() : null,
    revenueCents,
    drinksSold,
    orderCount,
    borrelCount: borrelMap.size,
    activeDrinkers: drinkerMap.size,
    avgOrderCents: orderCount > 0 ? Math.round(revenueCents / orderCount) : 0,
    bartenderCostCents,
    bartenderDrinks,
    cogsInclCents,
    pl: {
      activityCount: plIds.length,
      pppIncomeCents: plIncome._sum.totalCents ?? 0,
      // External cards at internal prices only; their markup is abProfitCents.
      externalIncomeCents: sumSplits(plExternal).internalCents,
      cogsInclCents,
    },
    abProfitCents: sumSplits(rangeExternal).abProfitCents,
    roleCosts,
    topBorrels,
    topDrinkers,
    topDrinks,
  });
}
