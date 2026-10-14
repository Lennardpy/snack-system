import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// DELETE — remove one mistaken order from an external tab. A tab left without
// orders is removed too.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const order = await prisma.pppExternalOrder.findUnique({ where: { id }, select: { tabId: true } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.pppExternalOrder.delete({ where: { id } }),
    prisma.pppExternalTab.deleteMany({ where: { id: order.tabId, orders: { none: {} } } }),
  ]);
  return NextResponse.json({ ok: true });
}
