import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";
import { VAT_RATE } from "@/lib/external";

// External-card orders at the bar POS. They go onto the borrel's external tab for
// that card (one tab per card per borrel), NOT to a member or Congressus. Each
// line snapshots the internal selling price (the drink's special price if set,
// else its price — no borrel specials or role discounts) and its VAT rate; the
// admin picks the price level later on the borrel page.

// Recent external orders at a borrel, for the POS history. Query: ?activityId=
export async function GET(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activityId = req.nextUrl.searchParams.get("activityId");
  if (!activityId) return NextResponse.json({ error: "activityId is required" }, { status: 400 });

  const orders = await prisma.pppExternalOrder.findMany({
    where: { tab: { activityId } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      tab: { select: { cardName: true, card: { select: { name: true } } } },
      lines: { select: { quantity: true, unitCents: true, product: { select: { id: true, name: true } } } },
    },
  });
  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      createdAt: o.createdAt,
      cardName: o.tab.card?.name ?? o.tab.cardName,
      totalCents: o.lines.reduce((s, l) => s + l.quantity * l.unitCents, 0),
      lines: o.lines,
    })),
  });
}

// Body: { cardId, activityId, lines: [{ productId, quantity }] }
export async function POST(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { cardId, activityId, lines } = await req.json().catch(() => ({}));
  if (typeof cardId !== "string" || typeof activityId !== "string" || !Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: "cardId, activityId and a non-empty lines[] are required" }, { status: 400 });
  }

  const qtyByProduct = new Map<string, number>();
  for (const line of lines) {
    const productId = line?.productId;
    const quantity = line?.quantity;
    if (typeof productId !== "string" || !Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Invalid line item" }, { status: 400 });
    }
    qtyByProduct.set(productId, (qtyByProduct.get(productId) ?? 0) + quantity);
  }

  const [card, activity, products] = await Promise.all([
    prisma.externalCard.findUnique({ where: { id: cardId } }),
    prisma.pppActivity.findUnique({ where: { id: activityId }, select: { status: true } }),
    prisma.pppProduct.findMany({
      where: { id: { in: [...qtyByProduct.keys()] }, archived: false },
      select: { id: true, price: true, specialPrice: true, vatCategory: true },
    }),
  ]);
  if (!card) return NextResponse.json({ error: "External card not found" }, { status: 404 });
  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  if (activity.status !== "OPEN") return NextResponse.json({ error: "Activity is closed" }, { status: 409 });

  const productById = new Map(products.map((p) => [p.id, p]));
  const lineData = [];
  for (const [productId, quantity] of qtyByProduct) {
    const p = productById.get(productId);
    if (!p) return NextResponse.json({ error: `Unknown or archived product: ${productId}` }, { status: 400 });
    lineData.push({ productId, quantity, unitCents: p.specialPrice ?? p.price, vatRate: VAT_RATE[p.vatCategory] });
  }

  const tab = await prisma.pppExternalTab.upsert({
    where: { activityId_cardId: { activityId, cardId } },
    update: {},
    create: { activityId, cardId, cardName: card.name },
  });
  const order = await prisma.pppExternalOrder.create({
    data: { tabId: tab.id, createdById: user.id, lines: { create: lineData } },
    select: { id: true, createdAt: true },
  });

  const totalCents = lineData.reduce((s, l) => s + l.unitCents * l.quantity, 0);
  return NextResponse.json({ order: { ...order, totalCents } });
}
