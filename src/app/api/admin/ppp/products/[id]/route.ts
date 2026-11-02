import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { productWhere, categoryWhere } from "@/lib/scope";

const VAT = ["ZERO", "LOW", "STANDARD"] as const;
type Vat = (typeof VAT)[number];

// Edit a PPP drink. Body may include name, price, categoryId, vatCategory,
// published, archived, sortOrder.
//
// NOTE: Congressus edit-sync (price/name/VAT) is intentionally NOT wired yet — it
// is blocked on the PPP folder + the confirmed VAT field name (plan §2/§10). The
// local DB is the source of truth for the POS; add the Congressus PATCH here once
// unblocked, mirroring updateCongressusProduct().
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const current = await prisma.pppProduct.findFirst({ where: { id, ...productWhere(ctx.scope) } });
  if (!current) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  const body = await req.json();

  const data: {
    name?: string;
    price?: number;
    specialPrice?: number | null;
    categoryId?: string;
    vatCategory?: Vat;
    color?: string | null;
    published?: boolean;
    archived?: boolean;
    sortOrder?: number;
  } = {};

  if (body.name !== undefined) {
    const trimmed = String(body.name).trim();
    if (!trimmed) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    data.name = trimmed;
  }
  if (body.price !== undefined) {
    if (typeof body.price !== "number" || body.price < 0) {
      return NextResponse.json({ error: "price must be a non-negative number of cents" }, { status: 400 });
    }
    data.price = Math.round(body.price);
  }
  if (body.specialPrice !== undefined) {
    data.specialPrice =
      body.specialPrice === null || body.specialPrice === ""
        ? null
        : Math.max(0, Math.round(Number(body.specialPrice)));
  }
  if (body.categoryId !== undefined) {
    // Only a category of the drink's own association.
    const cat = await prisma.pppProductCategory.findFirst({
      where: { id: String(body.categoryId), associationId: current.associationId, ...categoryWhere(ctx.scope) },
    });
    if (!cat) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    data.categoryId = cat.id;
  }
  if (body.color !== undefined) {
    data.color = typeof body.color === "string" && body.color.trim() ? body.color.trim() : null;
  }
  if (body.vatCategory !== undefined) {
    if (!VAT.includes(body.vatCategory)) {
      return NextResponse.json({ error: "Invalid vatCategory" }, { status: 400 });
    }
    data.vatCategory = body.vatCategory;
  }
  // Dimensie doesn't do VAT: its drinks always stay at none.
  if (current.associationId === "dimensie" && data.vatCategory !== undefined) data.vatCategory = "ZERO";
  if (body.published !== undefined) data.published = Boolean(body.published);
  if (body.archived !== undefined) data.archived = Boolean(body.archived);
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const product = await prisma.pppProduct.update({ where: { id }, data });
    return NextResponse.json({ product });
  } catch {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
}
