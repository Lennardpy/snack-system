import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSaleInvoice } from "@/lib/congressus";
import { requireAdmin } from "@/lib/auth";

export async function POST() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invoices = await prisma.saleInvoice.findMany({
    where: { status: "CONFIRMED" },
    include: { member: true, lines: { include: { product: true } } },
  });

  if (invoices.length === 0) {
    return NextResponse.json({ ok: true, exported: 0 });
  }

  const results = { exported: 0, failed: 0, errors: [] as string[] };

  for (const invoice of invoices) {
    try {
      const congressusInvoiceId = await createSaleInvoice(
        invoice.member.congressusId,
        invoice.lines.map((l) => ({
          name: l.product.name,
          quantity: l.quantity,
          price: l.unitCents / 100, // cents → euros
        })),
        `SSS #${invoice.id.slice(-6)}`
      );

      await prisma.saleInvoice.update({
        where: { id: invoice.id },
        data: {
          status: "EXPORTED",
          exportedAt: new Date(),
          congressusInvoiceId,
        },
      });

      results.exported++;
      console.log(`Exported invoice ${invoice.id} → Congressus #${congressusInvoiceId}`);
    } catch (err) {
      results.failed++;
      results.errors.push(`Invoice ${invoice.id}: ${(err as Error).message}`);
    }
  }

  return NextResponse.json(results);
}
