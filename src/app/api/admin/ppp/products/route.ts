import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { createPppCongressusProduct } from "@/lib/congressus";

const VAT = ["ZERO", "LOW", "STANDARD"] as const;
type Vat = (typeof VAT)[number];
function asVat(v: unknown): Vat {
  return VAT.includes(v as Vat) ? (v as Vat) : "LOW";
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [products, categories] = await Promise.all([
    prisma.pppProduct.findMany({
      include: { category: true },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    }),
    prisma.pppProductCategory.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  return NextResponse.json({ products, categories });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, price, specialPrice, categoryId, vatCategory, color } = await req.json();
  if (!name || typeof price !== "number" || !categoryId) {
    return NextResponse.json({ error: "name, price and categoryId are required" }, { status: 400 });
  }
  const colorVal = typeof color === "string" && color.trim() ? color.trim() : null;
  const special =
    specialPrice === null || specialPrice === undefined || specialPrice === ""
      ? null
      : Math.max(0, Math.round(Number(specialPrice)));

  const vat = asVat(vatCategory);

  // Create in our DB first.
  const product = await prisma.pppProduct.create({
    data: {
      name,
      price,
      specialPrice: special,
      categoryId,
      vatCategory: vat,
      color: colorVal,
      published: false,
    },
  });

  // Sync to Congressus — creates a matching product in Stress's PPP folder (8804).
  try {
    const { offerId } = await createPppCongressusProduct("stress", name, price / 100, vat);
    if (offerId !== null) {
      const updated = await prisma.pppProduct.update({
        where: { id: product.id },
        data: { congressusProductId: offerId, congressusProductOfferId: offerId },
      });
      return NextResponse.json({ product: updated });
    }
    return NextResponse.json({ product });
  } catch (err) {
    // Don't fail the create — the product exists locally; sync can be retried.
    console.error("Congressus PPP product sync failed:", err);
    return NextResponse.json({
      product,
      warning: `Product created locally but Congressus sync failed: ${(err as Error).message}`,
    });
  }
}
