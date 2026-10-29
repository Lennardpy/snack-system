import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { parseLimit } from "@/lib/external";

// PATCH { name?, limit? } renames an external card / sets its spending limit per
// borrel (euros; null or "" = no limit). DELETE removes it — its borrel tabs stay
// (they keep the card's name), so nothing already drunk is lost.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { name?: string; limitCents?: number | null } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    data.name = name;
  }
  if (body.limit !== undefined) {
    const limit = parseLimit(body.limit);
    if (limit === undefined) return NextResponse.json({ error: "Limit must be an amount in euros, or empty" }, { status: 400 });
    data.limitCents = limit;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { count } = await prisma.externalCard.updateMany({ where: { id }, data });
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
