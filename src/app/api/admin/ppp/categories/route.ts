import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { isStressSide } from "@/lib/scope";

export async function GET() {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const categories = await prisma.pppProductCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { products: true } } },
  });
  return NextResponse.json({ categories });
}

// Reorder categories. Body: { order: string[] } — category ids in the new order.
export async function PATCH(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) {
    return NextResponse.json({ error: "Not available for this association" }, { status: 403 });
  }

  const { order } = await req.json();
  if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "order must be an array of ids" }, { status: 400 });
  }

  await prisma.$transaction(
    order.map((id, index) =>
      prisma.pppProductCategory.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  const categories = await prisma.pppProductCategory.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) {
    return NextResponse.json({ error: "Not available for this association" }, { status: 403 });
  }

  const { name } = await req.json();
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const existing = await prisma.pppProductCategory.findUnique({ where: { name: trimmed } });
  if (existing) {
    return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
  }

  const last = await prisma.pppProductCategory.findFirst({ orderBy: { sortOrder: "desc" } });
  const category = await prisma.pppProductCategory.create({
    data: { name: trimmed, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  return NextResponse.json({ category });
}
