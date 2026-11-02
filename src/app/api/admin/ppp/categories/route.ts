import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { categoryWhere, inScope } from "@/lib/scope";
import { pickAssociation } from "@/lib/associations";

// Each association has its own drink list (categories + drinks). ?association=
// picks one for the overall admin; other logins always get their own.
export async function GET(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const association = ctx.scope ?? pickAssociation(req.nextUrl.searchParams.get("association"));

  const categories = await prisma.pppProductCategory.findMany({
    where: { associationId: association },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { products: true } } },
  });
  return NextResponse.json({ categories });
}

// Reorder categories. Body: { order: string[] } — category ids in the new order.
export async function PATCH(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { order } = await req.json();
  if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "order must be an array of ids" }, { status: 400 });
  }

  await prisma.$transaction(
    order.map((id, index) =>
      prisma.pppProductCategory.updateMany({ where: { id, ...categoryWhere(ctx.scope) }, data: { sortOrder: index } }),
    ),
  );

  const categories = await prisma.pppProductCategory.findMany({
    where: { id: { in: order }, ...categoryWhere(ctx.scope) },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, association: requested } = await req.json();
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  // The login's own drink list; the overall admin picks one.
  const association = ctx.scope ?? pickAssociation(requested);
  if (!inScope(ctx.scope, association)) return NextResponse.json({ error: "Unknown association" }, { status: 400 });

  const existing = await prisma.pppProductCategory.findUnique({
    where: { associationId_name: { associationId: association, name: trimmed } },
  });
  if (existing) {
    return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
  }

  const last = await prisma.pppProductCategory.findFirst({ where: { associationId: association }, orderBy: { sortOrder: "desc" } });
  const category = await prisma.pppProductCategory.create({
    data: { associationId: association, name: trimmed, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  return NextResponse.json({ category });
}
