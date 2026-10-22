import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { activityInScope } from "@/lib/scope-db";

// Add or update a drink special for this activity.
// Body: { productId, priceCents }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: activityId } = await params;
  if (!(await activityInScope(activityId, ctx.scope))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  const { productId, priceCents } = await req.json();
  if (typeof productId !== "string" || typeof priceCents !== "number" || priceCents < 0) {
    return NextResponse.json({ error: "productId and a non-negative priceCents are required" }, { status: 400 });
  }

  const [activity, product] = await Promise.all([
    prisma.pppActivity.findUnique({ where: { id: activityId } }),
    prisma.pppProduct.findUnique({ where: { id: productId } }),
  ]);
  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  if (!product) return NextResponse.json({ error: "Drink not found" }, { status: 404 });

  const discount = await prisma.pppActivityDiscount.upsert({
    where: { activityId_productId: { activityId, productId } },
    update: { priceCents: Math.round(priceCents) },
    create: { activityId, productId, priceCents: Math.round(priceCents) },
    include: { product: { select: { id: true, name: true, price: true, specialPrice: true } } },
  });

  return NextResponse.json({ discount });
}

// Remove a drink special. Query: ?productId=
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: activityId } = await params;
  if (!(await activityInScope(activityId, ctx.scope))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  const productId = req.nextUrl.searchParams.get("productId");
  if (!productId) return NextResponse.json({ error: "productId is required" }, { status: 400 });

  await prisma.pppActivityDiscount.deleteMany({ where: { activityId, productId } });
  return NextResponse.json({ ok: true });
}
