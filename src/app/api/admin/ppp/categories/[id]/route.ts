import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const data: { name?: string; bartenderFree?: boolean } = {};

  if (body.name !== undefined) {
    const trimmed = String(body.name).trim();
    if (!trimmed) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    const clash = await prisma.pppProductCategory.findUnique({ where: { name: trimmed } });
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
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
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
