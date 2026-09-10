import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { sumLineDiscounts, roleDiscountAmount } from "@/lib/roles";
import { SBZ_BY_KEY, sbzCostInclCents, sbzCostExclCents } from "@/lib/sbz";

// Activity detail + full profit/loss for the admin page:
//   • the activity (+ its drink specials) and the drink catalog for the picker
//   • revenue: member charges (itemised) — SumUp card revenue is fetched separately
//   • cost of goods: from the manually-entered SBZ usage (kegs kg, bottles units)
//   • discounts given: specials, per-role (Board/PilsCie/…), bartender comps
//   • a per-drink breakdown (consumed via member charges, revenue, discount)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [activity, products, invoices, usage] = await Promise.all([
    prisma.pppActivity.findUnique({
      where: { id },
      include: {
        discounts: {
          include: { product: { select: { id: true, name: true, price: true, specialPrice: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.pppProduct.findMany({
      where: { archived: false },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, price: true, specialPrice: true },
    }),
    prisma.pppInvoice.findMany({
      where: { activityId: id },
      select: {
        totalCents: true,
        member: { select: { roles: { select: { name: true, discountPercent: true, discountCents: true } } } },
        lines: {
          select: {
            quantity: true,
            unitCents: true,
            listCents: true,
            specialCents: true,
            bartenderFree: true,
            product: { select: { id: true, name: true, price: true } },
          },
        },
      },
    }),
    prisma.pppActivityUsage.findMany({ where: { activityId: id }, select: { sbzKey: true, quantity: true } }),
  ]);

  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  const allLines = invoices.flatMap((inv) => inv.lines);
  const discount = sumLineDiscounts(allLines);
  const memberRevenueCents = invoices.reduce((s, inv) => s + inv.totalCents, 0);

  // Per-role and bartender-comp discount cost (the association's cost), scoped to
  // this borrel — each line's discount attributed to the role that granted it.
  const roleCostMap = new Map<string, { costCents: number; drinks: number }>();
  let bartenderCostCents = 0;
  let bartenderDrinks = 0;

  // Per-drink breakdown (member-charge side).
  const drinkMap = new Map<
    string,
    { name: string; quantity: number; revenueCents: number; discountCents: number }
  >();

  for (const inv of invoices) {
    const roles = inv.member.roles;
    for (const l of inv.lines) {
      const list = l.listCents ?? l.product.price;
      const d = drinkMap.get(l.product.id) ?? { name: l.product.name, quantity: 0, revenueCents: 0, discountCents: 0 };
      d.quantity += l.quantity;
      d.revenueCents += l.unitCents * l.quantity;
      d.discountCents += Math.max(0, list - l.unitCents) * l.quantity;
      drinkMap.set(l.product.id, d);

      if (l.bartenderFree) {
        bartenderCostCents += list * l.quantity;
        bartenderDrinks += l.quantity;
        continue;
      }
      if (roles.length === 0) continue;
      const preRole = l.specialCents ?? l.listCents;
      if (preRole == null) continue;
      const ignoreFixed = l.specialCents != null;
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
        e.costCents += bestAmt * l.quantity;
        e.drinks += l.quantity;
        roleCostMap.set(bestRole, e);
      }
    }
  }

  const roleCosts = [...roleCostMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.costCents - a.costCents);
  const perDrink = [...drinkMap.values()].sort((a, b) => b.quantity - a.quantity);

  // Cost of goods from the entered SBZ usage.
  let cogsInclCents = 0;
  let cogsExclCents = 0;
  for (const u of usage) {
    if (!SBZ_BY_KEY[u.sbzKey]) continue;
    cogsInclCents += sbzCostInclCents(u.sbzKey, u.quantity);
    cogsExclCents += sbzCostExclCents(u.sbzKey, u.quantity);
  }

  return NextResponse.json({
    activity,
    products,
    orderCount: invoices.length,
    memberRevenueCents,
    specialsDiscountCents: discount.specialsCents,
    totalDiscountCents: discount.totalCents,
    roleCosts,
    bartenderCostCents,
    bartenderDrinks,
    perDrink,
    usage,
    cogsInclCents,
    cogsExclCents,
  });
}

// Save the manually-entered SBZ usage for this borrel.
// Body: { usage: [{ sbzKey, quantity }] } — quantity 0/blank removes the entry.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const activity = await prisma.pppActivity.findUnique({ where: { id }, select: { id: true } });
  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  const body = await req.json();
  const entries: { sbzKey: string; quantity: number }[] = Array.isArray(body.usage) ? body.usage : [];

  const clean = entries
    .filter((e) => typeof e?.sbzKey === "string" && SBZ_BY_KEY[e.sbzKey])
    .map((e) => ({ sbzKey: e.sbzKey, quantity: Math.max(0, Number(e.quantity) || 0) }));

  await prisma.$transaction([
    ...clean
      .filter((e) => e.quantity <= 0)
      .map((e) => prisma.pppActivityUsage.deleteMany({ where: { activityId: id, sbzKey: e.sbzKey } })),
    ...clean
      .filter((e) => e.quantity > 0)
      .map((e) =>
        prisma.pppActivityUsage.upsert({
          where: { activityId_sbzKey: { activityId: id, sbzKey: e.sbzKey } },
          update: { quantity: e.quantity },
          create: { activityId: id, sbzKey: e.sbzKey, quantity: e.quantity },
        })
      ),
  ]);

  return NextResponse.json({ ok: true });
}
