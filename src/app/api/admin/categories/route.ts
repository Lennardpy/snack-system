import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const categories = await prisma.productCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { products: true } } },
  });
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await req.json();
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const existing = await prisma.productCategory.findUnique({ where: { name: trimmed } });
  if (existing) {
    return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
  }

  // Append to the end of the current ordering.
  const last = await prisma.productCategory.findFirst({ orderBy: { sortOrder: "desc" } });
  const category = await prisma.productCategory.create({
    data: { name: trimmed, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  return NextResponse.json({ category });
}
