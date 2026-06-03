import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { createCongressusProduct, updateCongressusProduct } from "@/lib/congressus";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const data = await req.json();

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const product = await prisma.product.update({ where: { id }, data });

  // If name or price changed, keep Congressus in sync
  const nameChanged = data.name !== undefined && data.name !== existing.name;
  const priceChanged = data.price !== undefined && data.price !== existing.price;

  if (nameChanged || priceChanged) {
    const newName = data.name ?? existing.name;
    const newPriceCents = data.price ?? existing.price;

    if (product.congressusProductId) {
      // Update existing Congressus product
      updateCongressusProduct(product.congressusProductId, newName, newPriceCents / 100).catch(
        (err) => console.error(`Congressus update product ${product.congressusProductId} failed:`, err)
      );
    } else {
      // Product doesn't have a Congressus ID yet — create it now
      createCongressusProduct(newName, newPriceCents / 100)
        .then((congressusProductId) =>
          prisma.product.update({ where: { id }, data: { congressusProductId } })
        )
        .catch((err) => console.error("Congressus product create-on-update failed:", err));
    }
  }

  return NextResponse.json({ product });
}
