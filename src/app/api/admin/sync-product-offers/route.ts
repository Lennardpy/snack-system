import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { fetchSSSFolderProducts } from "@/lib/congressus";

// POST /api/admin/sync-product-offers
// Matches local products to Congressus folder products by name (and price) and
// stores the product_offer_id. Run this once to backfill existing products.
export async function POST() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [localProducts, congressusProducts] = await Promise.all([
    prisma.product.findMany({
      where: { congressusProductOfferId: null, archived: false },
    }),
    fetchSSSFolderProducts(),
  ]);

  const results = {
    synced: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
    matches: [] as { name: string; offerId: number }[],
  };

  for (const local of localProducts) {
    const localPriceEuros = local.price / 100;

    // Find matching Congressus products by name (case-insensitive)
    const byName = congressusProducts.filter(
      (c) => c.name.toLowerCase() === local.name.toLowerCase() && !c.is_archived
    );

    if (byName.length === 0) {
      results.errors.push(`"${local.name}": no matching product found in Congressus SSS folder`);
      results.failed++;
      continue;
    }

    // Prefer an exact price match; otherwise use the last (highest ID = most recent)
    const exactMatch = byName.find((c) => Math.abs(c.price - localPriceEuros) < 0.001);
    const best = exactMatch ?? byName[byName.length - 1];

    try {
      await prisma.product.update({
        where: { id: local.id },
        data: {
          congressusProductId: best.product_offer_id,
          congressusProductOfferId: best.product_offer_id,
        },
      });
      results.synced++;
      results.matches.push({ name: local.name, offerId: best.product_offer_id });
    } catch (err) {
      results.errors.push(`"${local.name}": DB update failed: ${(err as Error).message}`);
      results.failed++;
    }
  }

  // Count how many were already synced
  const alreadySynced = await prisma.product.count({
    where: { congressusProductOfferId: { not: null } },
  });
  results.skipped = alreadySynced;

  return NextResponse.json({ ok: results.failed === 0, ...results });
}

// GET — returns all products in the SSS Congressus folder for inspection
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [congressusProducts, localProducts] = await Promise.all([
    fetchSSSFolderProducts(),
    prisma.product.findMany({
      select: { id: true, name: true, price: true, congressusProductId: true, congressusProductOfferId: true },
    }),
  ]);

  return NextResponse.json({ congressusProducts, localProducts });
}
