import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { pppInvoiceWhere, inScope, type Scope } from "@/lib/scope";

// Orders are changed by the association hosting the borrel: Dimensie sees its
// members' orders at a joint borrel (Stress's) but can't edit them.
const hostsBorrel = (scope: Scope, hostId: string) => inScope(scope, hostId);
const readOnlyResponse = () =>
  NextResponse.json({ error: "This order is at a borrel Stress hosts — only Stress can change it." }, { status: 403 });

// PATCH — edit a pending (not yet exported) PPP order.
// Body: { lines: [{ id, quantity?, removeDiscount? }] }
//   • quantity <= 0 removes the line; otherwise sets the quantity.
//   • removeDiscount: charge the line at the drink's normal list price — drops
//     any borrel special, role discount (Board/PilsCie/…) and bartender free drink.
//     The line then counts as undiscounted in all discount/role-cost reports.
// The total is recalculated. If no lines remain, the order is deleted.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const updates: { id: string; quantity?: number; removeDiscount?: boolean }[] = Array.isArray(body.lines)
    ? body.lines
    : [];

  const invoice = await prisma.pppInvoice.findFirst({
    where: { id, ...pppInvoiceWhere(ctx.scope) },
    include: {
      activity: { select: { associationId: true } }, lines: { include: { product: { select: { price: true } } } } },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (!hostsBorrel(ctx.scope, invoice.activity.associationId)) return readOnlyResponse();
  if (invoice.status === "EXPORTING") {
    return NextResponse.json(
      { error: "This order is being exported (or waiting for a check after an export) and can't be changed now." },
      { status: 409 }
    );
  }
  if (invoice.status === "EXPORTED") {
    return NextResponse.json(
      { error: "This order was already exported to Congressus and can no longer be edited." },
      { status: 409 }
    );
  }

  const ops = [];
  for (const u of updates) {
    const line = invoice.lines.find((l) => l.id === u.id);
    if (!line) continue;
    const quantity = u.quantity === undefined ? line.quantity : Math.floor(Number(u.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      ops.push(prisma.pppInvoiceLine.delete({ where: { id: line.id } }));
      continue;
    }
    const data: { quantity?: number; unitCents?: number; listCents?: number; specialCents?: null; bartenderFree?: boolean } = {};
    if (quantity !== line.quantity) data.quantity = quantity;
    if (u.removeDiscount) {
      // Normal list price at sale time (snapshot), else the drink's current price.
      const list = line.listCents ?? line.product.price;
      data.unitCents = list;
      data.listCents = list;
      data.specialCents = null;
      data.bartenderFree = false;
    }
    if (Object.keys(data).length > 0) ops.push(prisma.pppInvoiceLine.update({ where: { id: line.id }, data }));
  }
  if (ops.length > 0) await prisma.$transaction(ops);

  const remaining = await prisma.pppInvoiceLine.findMany({ where: { invoiceId: id } });
  if (remaining.length === 0) {
    await prisma.pppInvoice.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  }
  const totalCents = remaining.reduce((s, l) => s + l.quantity * l.unitCents, 0);
  await prisma.pppInvoice.update({ where: { id }, data: { totalCents } });
  return NextResponse.json({ ok: true, totalCents });
}

// Delete a single PPP invoice (and its lines). Exported invoices are protected.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const invoice = await prisma.pppInvoice.findFirst({
    where: { id, ...pppInvoiceWhere(ctx.scope) },
    include: { activity: { select: { associationId: true } } },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (!hostsBorrel(ctx.scope, invoice.activity.associationId)) return readOnlyResponse();

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
    prisma.pppInvoiceLine.deleteMany({ where: { invoiceId: id } }),
    prisma.pppInvoice.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
