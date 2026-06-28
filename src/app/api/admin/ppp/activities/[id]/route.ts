import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// Activity detail for the admin page: the activity + its drink specials + the
// catalog of drinks to pick from.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [activity, products] = await Promise.all([
    prisma.pppActivity.findUnique({
      where: { id },
      include: {
        discounts: {
          include: { product: { select: { id: true, name: true, price: true, specialPrice: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.pppProduct.findMany({
      where: { archived: false },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, price: true, specialPrice: true },
    }),
  ]);

  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  return NextResponse.json({ activity, products });
}
