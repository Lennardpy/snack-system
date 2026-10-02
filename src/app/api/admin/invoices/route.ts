import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // CONFIRMED = pending export, EXPORTED, or EXPORTING = needs check (an export's
  // outcome was unknown — see /api/admin/invoices/reconcile).
  const raw = req.nextUrl.searchParams.get("status");
  const status = raw === "EXPORTED" || raw === "EXPORTING" ? raw : "CONFIRMED";

  const invoices = await prisma.saleInvoice.findMany({
    where: { status },
    include: {
      member: true,
      lines: { include: { product: true } },
    },
    orderBy: { confirmedAt: "desc" },
  });

  return NextResponse.json({ invoices });
}

// DELETE /api/admin/invoices?status=EXPORTED|CONFIRMED
// Bulk-deletes every invoice (and its lines) with the given status. Used to
// clear out test data so the dashboard starts counting fresh.
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = req.nextUrl.searchParams.get("status");
  if (status !== "EXPORTED" && status !== "CONFIRMED") {
    return NextResponse.json({ error: "status must be EXPORTED or CONFIRMED" }, { status: 400 });
  }

  const rows = await prisma.saleInvoice.findMany({ where: { status }, select: { id: true } });
  const ids = rows.map((r) => r.id);

  if (ids.length > 0) {
    await prisma.$transaction([
      prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: ids } } }),
      prisma.saleInvoice.deleteMany({ where: { id: { in: ids } } }),
    ]);
  }

  return NextResponse.json({ ok: true, deleted: ids.length });
}
