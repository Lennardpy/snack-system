import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { effectivePriceCents, discountStage } from "@/lib/pricing";

export async function GET() {
  // Public endpoint (the kiosk shop). Select ONLY the fields the shop needs —
  // never expose internal fields like Congressus IDs or timestamps.
  const rows = await prisma.product.findMany({
    where: { published: true, archived: false },
    select: {
      id: true,
      name: true,
      price: true,
      imageUrl: true,
      stock: true,
      expiresAt: true,
      category: { select: { name: true } },
    },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });

  // Compute the effective (possibly discounted) price; don't leak the raw
  // best-before date to the public payload.
  const products = rows.map(({ expiresAt, ...p }) => {
    const discount = discountStage(expiresAt);
    return {
      ...p,
      onSale: discount !== null,
      discount, // "HALF" | "FREE" | null
      salePrice: discount ? effectivePriceCents(p.price, expiresAt) : null,
    };
  });

  return NextResponse.json({ products });
}
