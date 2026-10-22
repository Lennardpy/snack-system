import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { isStressSide } from "@/lib/scope";

// DELETE — remove one mistaken order from an external tab. A tab left without
// orders is removed too.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) {
    return NextResponse.json({ error: "Not available for this association" }, { status: 403 });
  }

  const { id } = await params;
  const order = await prisma.pppExternalOrder.findUnique({ where: { id }, select: { tabId: true } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.pppExternalOrder.delete({ where: { id } }),
    prisma.pppExternalTab.deleteMany({ where: { id: order.tabId, orders: { none: {} } } }),
  ]);
  return NextResponse.json({ ok: true });
}
