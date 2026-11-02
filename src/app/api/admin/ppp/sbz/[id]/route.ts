import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { isStressSide } from "@/lib/scope";

// DELETE a price-list version (e.g. one saved with a wrong date). Borrels it
// covered fall back to the previous list. The oldest list can't be deleted — it's
// the base every earlier borrel is costed with.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) {
    return NextResponse.json({ error: "Not available for this association" }, { status: 403 });
  }

  const { id } = await params;
  const oldest = await prisma.sbzPriceList.findFirst({ orderBy: { validFrom: "asc" }, select: { id: true } });
  if (oldest?.id === id) {
    return NextResponse.json({ error: "The oldest price list is the base for all earlier borrels and can't be deleted." }, { status: 409 });
  }
  const { count } = await prisma.sbzPriceList.deleteMany({ where: { id } });
  if (count === 0) return NextResponse.json({ error: "Price list not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
