import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { fetchCongressusProductOfferId } from "@/lib/congressus";

// GET — returns raw Congressus product data for the first synced product, for debugging
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const product = await prisma.product.findFirst({
    where: { congressusProductId: { not: null } },
  });
  if (!product) return NextResponse.json({ error: "No synced products found" }, { status: 404 });

  const BASE = "https://api.congressus.nl/v30";
  const headers = {
    Authorization: `Bearer ${process.env.CONGRESSUS_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  // Fetch the product itself
  const productRes = await fetch(`${BASE}/products/${product.congressusProductId}`, { headers });
  const productData = productRes.ok ? await productRes.json() : { error: await productRes.text() };

  // Also try /product-offers?product_id=...
  const offersRes = await fetch(`${BASE}/product-offers?product_id=${product.congressusProductId}&page_size=10`, { headers });
  const offersData = offersRes.ok ? await offersRes.json() : { error: await offersRes.text(), status: offersRes.status };

  return NextResponse.json({
    localProduct: { id: product.id, name: product.name, congressusProductId: product.congressusProductId },
    congressusProduct: productData,
    congressusOffers: offersData,
  });
}

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
