import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// Delete a single PPP invoice (and its lines). Exported invoices are protected.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const invoice = await prisma.pppInvoice.findUnique({ where: { id } });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  if (invoice.status === "EXPORTED") {
    return NextResponse.json(
      { error: "This invoice was already exported to Congressus and cannot be deleted here." },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.pppInvoiceLine.deleteMany({ where: { invoiceId: id } }),
    prisma.pppInvoice.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
