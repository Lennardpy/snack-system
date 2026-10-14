import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// PATCH { name } renames an external card. DELETE removes it — its borrel tabs
// stay (they keep the card's name), so nothing already drunk is lost.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const { count } = await prisma.externalCard.updateMany({ where: { id }, data: { name } });
  if (count === 0) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { count } = await prisma.externalCard.deleteMany({ where: { id } });
  if (count === 0) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
