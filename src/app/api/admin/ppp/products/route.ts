import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { categoryWhere } from "@/lib/scope";
import { pickAssociation } from "@/lib/associations";
import { congressusConfig } from "@/lib/congressus";
import { createPppCongressusProduct } from "@/lib/congressus";

const VAT = ["ZERO", "LOW", "STANDARD"] as const;
type Vat = (typeof VAT)[number];
function asVat(v: unknown): Vat {
  return VAT.includes(v as Vat) ? (v as Vat) : "LOW";
}

// One association's drink list (Stress's is also used at joint borrels).
// ?association= picks one for the overall admin; other logins get their own.
export async function GET(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const association = ctx.scope ?? pickAssociation(req.nextUrl.searchParams.get("association"));

  const [products, categories] = await Promise.all([
    prisma.pppProduct.findMany({
      where: { associationId: association },
      include: { category: true },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    }),
    prisma.pppProductCategory.findMany({ where: { associationId: association }, orderBy: { sortOrder: "asc" } }),
  ]);

  return NextResponse.json({ products, categories });
}

export async function POST(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, price, specialPrice, categoryId, vatCategory, color } = await req.json();
  if (!name || typeof price !== "number" || !categoryId) {
    return NextResponse.json({ error: "name, price and categoryId are required" }, { status: 400 });
  }
  const colorVal = typeof color === "string" && color.trim() ? color.trim() : null;
  const special =
    specialPrice === null || specialPrice === undefined || specialPrice === ""
      ? null
      : Math.max(0, Math.round(Number(specialPrice)));

  // The drink joins its category's association (which must be the login's).
  const category = await prisma.pppProductCategory.findFirst({ where: { id: categoryId, ...categoryWhere(ctx.scope) } });
  if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  const association = category.associationId as "stress" | "dimensie";
  // Dimensie doesn't do VAT: its drinks carry none.
  const vat = association === "dimensie" ? "ZERO" : asVat(vatCategory);

  // Create in our DB first.
  const product = await prisma.pppProduct.create({
    data: {
      associationId: association,
      name,
      price,
      specialPrice: special,
      categoryId,
      vatCategory: vat,
      color: colorVal,
      published: false,
    },
  });

  // Sync to Congressus — creates a matching product in the association's PPP folder
  // (Stress: 8804). Skipped while that association has no PPP folder configured yet.
  if (congressusConfig(association).pppFolderId == null) return NextResponse.json({ product });
  try {
    const { offerId } = await createPppCongressusProduct(association, name, price / 100, vat);
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
