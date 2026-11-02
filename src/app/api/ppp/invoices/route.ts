import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";
import { activityVisible } from "@/lib/scope-db";
import { posScope } from "@/lib/scope";
import { priceOrder, activityUnitPrice, type OrderItem } from "@/lib/roles";
import { resolvePayer, samePerson } from "@/lib/memberships";
import { VAT_RATE } from "@/lib/external";
import { wallstreetChargePrices } from "@/lib/wallstreet";

// Live order history for an activity. Query: ?activityId=
export async function GET(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activityId = req.nextUrl.searchParams.get("activityId");
  if (!activityId) {
    return NextResponse.json({ error: "activityId is required" }, { status: 400 });
  }
  // Staff tied to an association only work at its borrels (Dimensie also at joint ones).
  if (!(await activityVisible(activityId, posScope(user)))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const invoices = await prisma.pppInvoice.findMany({
    where: { activityId },
    orderBy: { confirmedAt: "desc" },
    take: 50,
    select: {
      id: true,
      totalCents: true,
      confirmedAt: true,
      member: { select: { firstName: true, lastName: true } },
      // The tapper who rang the order up, shown to the admin. Prefer the linked
      // member's name; fall back to the login email.
      createdBy: {
        select: { email: true, member: { select: { firstName: true, lastName: true } } },
      },
      lines: {
        select: { quantity: true, unitCents: true, product: { select: { id: true, name: true } } },
      },
    },
  });

  return NextResponse.json({ invoices });
}

// Confirm an order. Body: { memberId, activityId, lines: [{ productId, quantity }], wallstreetTick? }
// Creates one CONFIRMED PppInvoice + its lines in a single transaction. Prices are
// looked up server-side and snapshotted onto each line — the client's prices are
// never trusted. The member is resolved from the shared Member table.
export async function POST(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memberId, activityId, lines, wallstreetTick } = await req.json();

  if (!memberId || !activityId || !Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json(
      { error: "memberId, activityId and a non-empty lines[] are required" },
      { status: 400 }
    );
  }
  // Staff tied to an association only work at its borrels (Dimensie also at joint ones).
  if (!(await activityVisible(activityId, posScope(user)))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  // Collapse duplicate productIds and validate quantities.
  const qtyByProduct = new Map<string, number>();
  for (const line of lines) {
    const productId = line?.productId;
    const quantity = line?.quantity;
    if (typeof productId !== "string" || !Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Invalid line item" }, { status: 400 });
    }
    qtyByProduct.set(productId, (qtyByProduct.get(productId) ?? 0) + quantity);
  }

  // Activity must exist and be open to new orders. Pull its drink specials so we
  // can price them authoritatively (only when the activity's discounts are active).
  const activity = await prisma.pppActivity.findUnique({
    where: { id: activityId },
    include: { discounts: { select: { productId: true, priceCents: true } } },
  });
  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  if (activity.status !== "OPEN") {
    return NextResponse.json({ error: "Activity is closed" }, { status: 409 });
  }
  // The membership that pays here (resolved server-side, never trusted from the
  // client): only members allowed at this borrel; someone in both associations
  // pays as a Stress member at a joint borrel. Their own association's roles give
  // the best (highest) discount they qualify for.
  const payerResult = await resolvePayer(memberId, activity);
  if (!payerResult.ok) return NextResponse.json({ error: payerResult.error }, { status: payerResult.status });
  const payer = payerResult.payer;

  const specialMap = new Map(
    activity.discountsActive ? activity.discounts.map((d) => [d.productId, d.priceCents]) : []
  );

  // Authoritative prices from the DB (never trust client-supplied prices), from the
  // drink list of the association hosting the borrel (Stress's at a joint borrel).
  const products = await prisma.pppProduct.findMany({
    where: { id: { in: [...qtyByProduct.keys()] }, archived: false, associationId: activity.associationId },
    select: {
      id: true,
      price: true,
      specialPrice: true,
      vatCategory: true,
      category: { select: { bartenderFree: true } },
    },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  // Wall Street mode: its drinks cost the market price (of the tick the POS
  // showed, if recent) instead of their price and any borrel special. Role
  // discounts and bartender free drinks apply on top as usual.
  const wallstreet = await wallstreetChargePrices(activityId, wallstreetTick);

  // The on-shift bartender drinks free from bartender-free categories when they
  // charge THEIR OWN card. Keyed off the session user's linked member, so it can't
  // be spoofed and only applies to the bartender operating this POS. (Same person
  // across memberships: a Dimensie bartender charged as Stress member at a joint borrel.)
  const chargingSelf = await samePerson(user.memberId, payer.email);

  // Validate products, then price the whole order at once: an own-drink-only role
  // (PilsCie) discounts just one unit — the rest of a round is charged normally.
  const items: OrderItem[] = [];
  for (const [productId, quantity] of qtyByProduct) {
    const product = productById.get(productId);
    if (!product) {
      return NextResponse.json(
        { error: `Unknown or archived product: ${productId}` },
        { status: 400 }
      );
    }
    const wsCents = wallstreet?.get(productId);
    items.push({
      productId,
      quantity,
      product: wsCents != null ? { ...product, price: wsCents, specialPrice: null } : product,
      // Activity special (if active) > product special > price, then role discounts
      // (fixed-cent skipped on any special).
      activitySpecialCents: wsCents != null ? null : specialMap.get(productId) ?? null,
      // A bartender-free line is comped to €0 (the association covers listCents).
      free: chargingSelf && product.category.bartenderFree,
    });
  }
  const itemById = new Map(items.map((it) => [it.productId, it]));

  // Snapshots for budget/discount reporting at close: the normal list price and
  // the activity drink-special price that applied (null if no activity special);
  // and for Stress's monthly invoice to Dimensie: the price before role discounts
  // and bartender comps, and the drink's VAT rate.
  const lineData = priceOrder(items, payer.roles).map((part) => {
    const it = itemById.get(part.productId)!;
    return {
      productId: part.productId,
      quantity: part.quantity,
      unitCents: part.unitCents,
      listCents: it.product.price,
      specialCents: it.activitySpecialCents,
      bartenderFree: it.free ?? false,
      baseCents: activityUnitPrice(it.product, it.activitySpecialCents),
      vatRate: VAT_RATE[productById.get(part.productId)!.vatCategory],
    };
  });
  const totalCents = lineData.reduce((sum, l) => sum + l.unitCents * l.quantity, 0);

  const invoice = await prisma.pppInvoice.create({
    data: {
      memberId: payer.id,
      activityId,
      totalCents,
      createdById: user.id, // the bartender/tapper who rang this up
      // status defaults to CONFIRMED — a bartender confirm is final.
      lines: { create: lineData },
    },
    select: { id: true, totalCents: true, confirmedAt: true },
  });

  return NextResponse.json({ invoice });
}
