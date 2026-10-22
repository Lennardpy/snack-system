import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { isStressSide } from "@/lib/scope";

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
  if (!isStressSide(ctx.scope)) {
    return NextResponse.json({ error: "Not available for this association" }, { status: 403 });
  }

  const { id } = await params;
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
  if (body.categoryId !== undefined) data.categoryId = String(body.categoryId);
  if (body.color !== undefined) {
    data.color = typeof body.color === "string" && body.color.trim() ? body.color.trim() : null;
  }
  if (body.vatCategory !== undefined) {
    if (!VAT.includes(body.vatCategory)) {
      return NextResponse.json({ error: "Invalid vatCategory" }, { status: 400 });
    }
    data.vatCategory = body.vatCategory;
  }
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
