import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// PATCH /api/admin/invoices/[id]
// Edit invoice line quantities. Body: { lines: [{ id, quantity }] }.
// A quantity <= 0 removes that line. The total is recalculated. Only invoices
// that have NOT yet been exported to Congressus may be edited.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const updates: { id: string; quantity: number }[] = body.lines ?? [];

  const invoice = await prisma.saleInvoice.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  if (invoice.status === "EXPORTING") {
    return NextResponse.json(
      { error: "This order is being exported (or waiting for a check after an export) and can't be changed now." },
      { status: 409 }
    );
  }
  if (invoice.status === "EXPORTED") {
    return NextResponse.json(
      { error: "This invoice was already exported to Congressus and can no longer be edited." },
      { status: 409 }
    );
  }

  const ops = [];
  for (const u of updates) {
    const line = invoice.lines.find((l) => l.id === u.id);
    if (!line) continue;
    if (u.quantity <= 0) {
      ops.push(prisma.invoiceLine.delete({ where: { id: u.id } }));
    } else if (u.quantity !== line.quantity) {
      ops.push(prisma.invoiceLine.update({ where: { id: u.id }, data: { quantity: u.quantity } }));
    }
  }
  if (ops.length > 0) await prisma.$transaction(ops);

  // Recalculate the total from the remaining lines.
  const remaining = await prisma.invoiceLine.findMany({ where: { invoiceId: id } });
  const totalCents = remaining.reduce((s, l) => s + l.quantity * l.unitCents, 0);
  await prisma.saleInvoice.update({ where: { id }, data: { totalCents } });

  const updated = await prisma.saleInvoice.findUnique({
    where: { id },
    include: { member: true, lines: { include: { product: true } } },
  });
  return NextResponse.json({ invoice: updated });
}

// DELETE /api/admin/invoices/[id] — remove an invoice and its lines.
// Blocked for already-exported invoices.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const invoice = await prisma.saleInvoice.findUnique({ where: { id } });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  if (invoice.status === "EXPORTING") {
    return NextResponse.json(
      { error: "This order is being exported (or waiting for a check after an export) and can't be changed now." },
      { status: 409 }
    );
  }
  if (invoice.status === "EXPORTED") {
    return NextResponse.json(
      { error: "This invoice was already exported to Congressus and cannot be deleted here." },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.invoiceLine.deleteMany({ where: { invoiceId: id } }),
    prisma.saleInvoice.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
