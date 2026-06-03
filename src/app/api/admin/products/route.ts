import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { createCongressusProduct } from "@/lib/congressus";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      include: { category: true },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    }),
    prisma.productCategory.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  return NextResponse.json({ products, categories });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, price, categoryId, stock } = await req.json();

  // Create in our DB first
  const product = await prisma.product.create({
    data: { name, price, categoryId, stock: stock ?? null, published: false },
  });

  // Sync to Congressus — create a matching product in the SSS folder
  try {
    const congressusProductId = await createCongressusProduct(name, price / 100);
    await prisma.product.update({
      where: { id: product.id },
      data: { congressusProductId },
    });
    return NextResponse.json({ product: { ...product, congressusProductId } });
  } catch (err) {
    // Don't fail the create — product exists locally, Congressus sync can be retried
    console.error("Congressus product sync failed:", err);
    return NextResponse.json({
      product,
      warning: `Product created locally but Congressus sync failed: ${(err as Error).message}`,
    });
  }
}
