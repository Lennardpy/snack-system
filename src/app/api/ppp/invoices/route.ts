import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";
import { productDiscountedUnitPrice } from "@/lib/roles";

// Live order history for an activity. Query: ?activityId=
export async function GET(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activityId = req.nextUrl.searchParams.get("activityId");
  if (!activityId) {
    return NextResponse.json({ error: "activityId is required" }, { status: 400 });
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
      lines: {
        select: { quantity: true, unitCents: true, product: { select: { name: true } } },
      },
    },
  });

  return NextResponse.json({ invoices });
}

// Confirm an order. Body: { memberId, activityId, lines: [{ productId, quantity }] }
// Creates one CONFIRMED PppInvoice + its lines in a single transaction. Prices are
// looked up server-side and snapshotted onto each line — the client's prices are
// never trusted. The member is resolved from the shared Member table.
export async function POST(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memberId, activityId, lines } = await req.json();

  if (!memberId || !activityId || !Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json(
      { error: "memberId, activityId and a non-empty lines[] are required" },
      { status: 400 }
    );
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

  // Member must exist in the shared member DB and be active. Pull their roles so
  // we can apply the best (highest) discount they qualify for.
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: { roles: { select: { discountPercent: true, discountCents: true } } },
  });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (!member.active) return NextResponse.json({ error: "Member inactive" }, { status: 403 });

  // Activity must exist and be open to new orders.
  const activity = await prisma.pppActivity.findUnique({ where: { id: activityId } });
  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  if (activity.status !== "OPEN") {
    return NextResponse.json({ error: "Activity is closed" }, { status: 409 });
  }

  // Authoritative prices from the DB (never trust client-supplied prices).
  const products = await prisma.pppProduct.findMany({
    where: { id: { in: [...qtyByProduct.keys()] }, archived: false },
    select: { id: true, price: true, specialPrice: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const lineData: { productId: string; quantity: number; unitCents: number }[] = [];
  let totalCents = 0;
  for (const [productId, quantity] of qtyByProduct) {
    const product = productById.get(productId);
    if (!product) {
      return NextResponse.json(
        { error: `Unknown or archived product: ${productId}` },
        { status: 400 }
      );
    }
    // Snapshot the discounted unit price onto the line. A special price uses the
    // special amount and skips fixed-cent role discounts (percentages still apply).
    const unitCents = productDiscountedUnitPrice(product, member.roles);
    lineData.push({ productId, quantity, unitCents });
    totalCents += unitCents * quantity;
  }

  const invoice = await prisma.pppInvoice.create({
    data: {
      memberId,
      activityId,
      totalCents,
      // status defaults to CONFIRMED — a bartender confirm is final.
      lines: { create: lineData },
    },
    select: { id: true, totalCents: true, confirmedAt: true },
  });

  return NextResponse.json({ invoice });
}
