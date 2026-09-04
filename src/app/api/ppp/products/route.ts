import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";

// Published, non-archived PPP drinks for the POS screen, grouped-ready (the
// client groups by category). Returns category for the tab bar.
export async function GET() {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const products = await prisma.pppProduct.findMany({
    where: { published: true, archived: false },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      price: true,
      specialPrice: true,
      imageUrl: true,
      color: true,
      categoryId: true,
      category: { select: { id: true, name: true, sortOrder: true, bartenderFree: true } },
    },
  });

  return NextResponse.json({ products });
}
