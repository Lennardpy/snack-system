import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  // Public endpoint (the kiosk shop). Select ONLY the fields the shop needs —
  // never expose internal fields like Congressus IDs or timestamps.
  const products = await prisma.product.findMany({
    where: { published: true, archived: false },
    select: {
      id: true,
      name: true,
      price: true,
      imageUrl: true,
      stock: true,
      category: { select: { name: true } },
    },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
  return NextResponse.json({ products });
}
