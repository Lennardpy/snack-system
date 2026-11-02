import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { isStressSide } from "@/lib/scope";
import { isPriceLevel } from "@/lib/external";

// PATCH { title?, priceLevel? } — the PDF's title and the price level the tab is
// invoiced at. DELETE removes the whole tab (all its orders).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) {
    return NextResponse.json({ error: "Not available for this association" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { title?: string | null; priceLevel?: "INTERNAL" | "INTERNAL_PLUS_10" | "TUSSEN" | "EXTERNAL" } = {};
  if (body.title !== undefined) {
    if (body.title !== null && typeof body.title !== "string") {
      return NextResponse.json({ error: "Invalid title" }, { status: 400 });
    }
    data.title = body.title?.trim().slice(0, 120) || null;
  }
  if (body.priceLevel !== undefined) {
    if (!isPriceLevel(body.priceLevel)) return NextResponse.json({ error: "Invalid price level" }, { status: 400 });
    data.priceLevel = body.priceLevel;
  }

  const { count } = await prisma.pppExternalTab.updateMany({ where: { id }, data });
  if (count === 0) return NextResponse.json({ error: "Tab not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) {
    return NextResponse.json({ error: "Not available for this association" }, { status: 403 });
  }

  const { id } = await params;
  const { count } = await prisma.pppExternalTab.deleteMany({ where: { id } });
  if (count === 0) return NextResponse.json({ error: "Tab not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
