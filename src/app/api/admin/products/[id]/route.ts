import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { createCongressusProduct, updateCongressusProduct, fetchCongressusProductOfferId } from "@/lib/congressus";

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
      // Update existing Congressus product; also backfill offer ID if missing
      updateCongressusProduct(product.congressusProductId, newName, newPriceCents / 100)
        .then(async () => {
          if (!product.congressusProductOfferId) {
            const offerId = await fetchCongressusProductOfferId(product.congressusProductId!);
            if (offerId) {
              await prisma.product.update({ where: { id }, data: { congressusProductOfferId: offerId } });
            }
          }
        })
        .catch((err) => console.error(`Congressus update product ${product.congressusProductId} failed:`, err));
    } else {
      // Product doesn't have a Congressus ID yet — create it now
      createCongressusProduct(newName, newPriceCents / 100)
        .then(({ productId: congressusProductId, offerId: congressusProductOfferId }) =>
          prisma.product.update({
            where: { id },
            data: {
              congressusProductId,
              ...(congressusProductOfferId ? { congressusProductOfferId } : {}),
            },
          })
        )
        .catch((err) => console.error("Congressus product create-on-update failed:", err));
    }
  }

  return NextResponse.json({ product });
}
