import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// List PPP invoices for the admin invoices section.
// ?status=CONFIRMED (pending export) | EXPORTED
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = (req.nextUrl.searchParams.get("status") ?? "CONFIRMED") as "CONFIRMED" | "EXPORTED";

  const invoices = await prisma.pppInvoice.findMany({
    where: { status },
    include: {
      member: { select: { firstName: true, lastName: true, email: true } },
      activity: { select: { name: true } },
      lines: { include: { product: { select: { name: true, price: true } } } },
    },
    orderBy: { confirmedAt: "desc" },
  });

  return NextResponse.json({ invoices });
}

// Bulk-delete PPP invoices (and their lines) by status — clears test data.
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = req.nextUrl.searchParams.get("status");
  if (status !== "EXPORTED" && status !== "CONFIRMED") {
    return NextResponse.json({ error: "status must be EXPORTED or CONFIRMED" }, { status: 400 });
  }

  const rows = await prisma.pppInvoice.findMany({ where: { status }, select: { id: true } });
  const ids = rows.map((r) => r.id);

  if (ids.length > 0) {
    await prisma.$transaction([
      prisma.pppInvoiceLine.deleteMany({ where: { invoiceId: { in: ids } } }),
      prisma.pppInvoice.deleteMany({ where: { id: { in: ids } } }),
    ]);
  }

  return NextResponse.json({ ok: true, deleted: ids.length });
}
