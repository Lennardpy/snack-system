import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { clampPercent, clampCents } from "@/lib/roles";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const data: { name?: string; discountPercent?: number; discountCents?: number; color?: string | null } = {};

  if (body.name !== undefined) {
    const trimmed = String(body.name).trim();
    if (!trimmed) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    const clash = await prisma.memberRole.findUnique({ where: { name: trimmed } });
    if (clash && clash.id !== id) {
      return NextResponse.json({ error: "A role with that name already exists" }, { status: 409 });
    }
    data.name = trimmed;
  }
  if (body.discountPercent !== undefined) data.discountPercent = clampPercent(Number(body.discountPercent));
  if (body.discountCents !== undefined) data.discountCents = clampCents(Number(body.discountCents));
  if (body.color !== undefined) {
    data.color = typeof body.color === "string" && body.color.trim() ? body.color.trim() : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const role = await prisma.memberRole.update({ where: { id }, data });
    return NextResponse.json({ role });
  } catch {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Deleting a role simply unlinks it from members (the join rows cascade); the
  // members themselves are untouched.
  try {
    await prisma.memberRole.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }
}
