import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSaleInvoice, CreateSaleInvoiceItem } from "@/lib/congressus";
import { requireAdmin } from "@/lib/auth";

// Fallback product offer ID if a product has no congressusProductId yet.
// "SSS Snack Purchase" — the generic product created in the SSS folder.
const FALLBACK_PRODUCT_OFFER_ID = parseInt(
  process.env.CONGRESSUS_PRODUCT_OFFER_ID ?? "118387",
  10
);

export async function POST() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch all confirmed invoices with their lines and member info
  const confirmed = await prisma.saleInvoice.findMany({
    where: { status: "CONFIRMED" },
    include: {
      member: true,
      lines: { include: { product: true } },
    },
    orderBy: { confirmedAt: "asc" },
  });

  if (confirmed.length === 0) {
    return NextResponse.json({ ok: true, exported: 0, congressusInvoices: 0 });
  }

  // ── Group by member × calendar month ──────────────────────────────────────
  // Key: "<memberId>-<YYYY>-<MM>"
  type Group = {
    memberId: string;
    congressusMemberId: number;
    memberName: string;
    yearMonth: string; // "2026-01"
    invoiceIds: string[];
    items: CreateSaleInvoiceItem[];
  };

  const groups = new Map<string, Group>();

  for (const invoice of confirmed) {
    const d = invoice.confirmedAt ?? invoice.createdAt;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const yearMonth = `${year}-${month}`;
    const key = `${invoice.memberId}-${yearMonth}`;

    if (!groups.has(key)) {
      groups.set(key, {
        memberId: invoice.memberId,
        congressusMemberId: invoice.member.congressusId,
        memberName: `${invoice.member.firstName} ${invoice.member.lastName}`,
        yearMonth,
        invoiceIds: [],
        items: [],
      });
    }

    const group = groups.get(key)!;
    group.invoiceIds.push(invoice.id);

    // Date label used in the item description: "3 jan", "14 mrt", etc.
    const dateLabel = d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });

    for (const line of invoice.lines) {
      group.items.push({
        name: line.product.name,
        description: dateLabel,
        quantity: line.quantity,
        price: line.unitCents / 100,
        productOfferId: line.product.congressusProductId ?? FALLBACK_PRODUCT_OFFER_ID,
      });
    }
  }

  // ── Export each group as one Congressus invoice ────────────────────────────
  const results = {
    ok: true,
    exported: 0,       // SSS invoices marked EXPORTED
    congressusInvoices: 0, // Congressus invoices created
    failed: 0,
    errors: [] as string[],
  };

  for (const group of groups.values()) {
    // Human-readable month name for the invoice reference
    const [year, month] = group.yearMonth.split("-");
    const monthName = new Date(Number(year), Number(month) - 1, 1).toLocaleString("nl-NL", {
      month: "long",
      year: "numeric",
    });
    const reference = `SSS ${monthName}`;

    try {
      const congressusInvoiceId = await createSaleInvoice(
        group.congressusMemberId,
        group.items,
        reference
      );

      // Mark all SSS invoices in this group as exported
      await prisma.saleInvoice.updateMany({
        where: { id: { in: group.invoiceIds } },
        data: {
          status: "EXPORTED",
          exportedAt: new Date(),
          congressusInvoiceId,
        },
      });

      results.exported += group.invoiceIds.length;
      results.congressusInvoices++;
      console.log(
        `Exported ${group.invoiceIds.length} invoice(s) for ${group.memberName} (${group.yearMonth}) → Congressus #${congressusInvoiceId}`
      );
    } catch (err) {
      results.failed++;
      results.ok = false;
      results.errors.push(
        `${group.memberName} (${group.yearMonth}): ${(err as Error).message}`
      );
      console.error(`Export failed for ${group.memberName} (${group.yearMonth}):`, err);
    }
  }

  return NextResponse.json(results);
}
