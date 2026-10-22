import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { categoryWhere } from "@/lib/scope";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const current = await prisma.pppProductCategory.findFirst({ where: { id, ...categoryWhere(ctx.scope) } });
  if (!current) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  const body = await req.json();

  const data: { name?: string; bartenderFree?: boolean } = {};

  if (body.name !== undefined) {
    const trimmed = String(body.name).trim();
    if (!trimmed) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    const clash = await prisma.pppProductCategory.findUnique({
      where: { associationId_name: { associationId: current.associationId, name: trimmed } },
    });
    if (clash && clash.id !== id) {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
    }
    data.name = trimmed;
  }
  if (body.bartenderFree !== undefined) data.bartenderFree = Boolean(body.bartenderFree);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const category = await prisma.pppProductCategory.update({ where: { id }, data });
  return NextResponse.json({ category });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await prisma.pppProductCategory.findFirst({ where: { id, ...categoryWhere(ctx.scope) } }))) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }
  const count = await prisma.pppProduct.count({ where: { categoryId: id } });
  if (count > 0) {
    return NextResponse.json(
      { error: `Category still has ${count} product${count === 1 ? "" : "s"}. Move or archive them first.` },
      { status: 409 },
    );
  }

  await prisma.pppProductCategory.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
