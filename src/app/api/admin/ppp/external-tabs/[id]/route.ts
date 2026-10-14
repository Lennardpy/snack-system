import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { isPriceLevel } from "@/lib/external";

// PATCH { title?, priceLevel? } — the PDF's title and the price level the tab is
// invoiced at. DELETE removes the whole tab (all its orders).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { count } = await prisma.pppExternalTab.deleteMany({ where: { id } });
  if (count === 0) return NextResponse.json({ error: "Tab not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
