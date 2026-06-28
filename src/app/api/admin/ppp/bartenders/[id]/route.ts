import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// Delete a bartender account (cascades sessions + invite token).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "BARTENDER") {
    return NextResponse.json({ error: "Bartender not found" }, { status: 404 });
  }

  // Sessions cascade (onDelete: Cascade); the invite token cascades too.
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
