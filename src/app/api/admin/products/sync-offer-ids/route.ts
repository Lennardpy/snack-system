import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { fetchCongressusProductOfferId } from "@/lib/congressus";

// POST /api/admin/products/sync-offer-ids
// Backfills congressusProductOfferId for products that have a congressusProductId
// but are missing the offer ID (products created before this feature was added).
export async function POST() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const products = await prisma.product.findMany({
    where: {
      congressusProductId: { not: null },
      congressusProductOfferId: null,
    },
  });

  const results = { synced: 0, failed: 0, errors: [] as string[] };

  for (const product of products) {
    try {
      const offerId = await fetchCongressusProductOfferId(product.congressusProductId!);
      if (offerId) {
        await prisma.product.update({
          where: { id: product.id },
          data: { congressusProductOfferId: offerId },
        });
        results.synced++;
        console.log(`Synced offer ID ${offerId} for product "${product.name}" (Congressus #${product.congressusProductId})`);
      } else {
        results.errors.push(`"${product.name}" (Congressus #${product.congressusProductId}): no offer ID found in API response`);
        results.failed++;
      }
    } catch (err) {
      results.errors.push(`"${product.name}": ${(err as Error).message}`);
      results.failed++;
    }
  }

  return NextResponse.json({ ok: results.failed === 0, ...results });
}
