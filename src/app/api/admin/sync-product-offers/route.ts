import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { fetchCongressusProductOfferId } from "@/lib/congressus";

// GET — probes Congressus API to debug product sync issues
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const BASE = "https://api.congressus.nl/v30";
  const hdrs = {
    Authorization: `Bearer ${process.env.CONGRESSUS_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  // 1. Check token works — fetch SSS folder products
  const folderRes = await fetch(`${BASE}/products?folder_id=5952&page_size=10`, { headers: hdrs });
  const folderData = folderRes.ok ? await folderRes.json() : { error: await folderRes.text(), status: folderRes.status };

  // 2. Try creating a test product
  const createRes = await fetch(`${BASE}/products`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({ folder_id: 5952, name: "__debug_test__", price: 0.01 }),
  });
  const createData = createRes.ok ? await createRes.json() : { error: await createRes.text(), status: createRes.status };

  // 3. If creation succeeded, fetch the created product back and check for offers
  let fetchedProduct = null;
  let offersData = null;
  if (createRes.ok && createData.id) {
    const pRes = await fetch(`${BASE}/products/${createData.id}`, { headers: hdrs });
    fetchedProduct = pRes.ok ? await pRes.json() : { error: await pRes.text() };

    const oRes = await fetch(`${BASE}/product-offers?product_id=${createData.id}&page_size=10`, { headers: hdrs });
    offersData = oRes.ok ? await oRes.json() : { error: await oRes.text(), status: oRes.status };

    // Clean up: delete the test product
    await fetch(`${BASE}/products/${createData.id}`, { method: "DELETE", headers: hdrs });
  }

  // 4. Check all local products and their sync status
  const localProducts = await prisma.product.findMany({
    select: { id: true, name: true, congressusProductId: true, congressusProductOfferId: true },
  });

  return NextResponse.json({
    tokenEnvSet: !!process.env.CONGRESSUS_API_TOKEN,
    folderProducts: folderData,
    createAttempt: { status: createRes.status, body: createData },
    fetchedProduct,
    offersData,
    localProducts,
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
