import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSaleInvoice, InvoiceLineItem } from "@/lib/congressus";
import { requireAdmin } from "@/lib/auth";

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
  type Group = {
    memberId: string;
    congressusMemberId: number;
    memberName: string;
    yearMonth: string; // "2026-01"
    invoiceIds: string[];
    // Aggregate quantities per product for clean invoice lines
    lineMap: Map<string, {
      productName: string;
      quantity: number;
      unitCents: number;
      congressusOfferId: number | null;
    }>;
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
        lineMap: new Map(),
      });
    }

    const group = groups.get(key)!;
    group.invoiceIds.push(invoice.id);

    // Merge invoice lines — aggregate quantities per product (at same unitCents)
    for (const line of invoice.lines) {
      const lineKey = `${line.productId}-${line.unitCents}`;
      if (group.lineMap.has(lineKey)) {
        group.lineMap.get(lineKey)!.quantity += line.quantity;
      } else {
        group.lineMap.set(lineKey, {
          productName: line.product.name,
          quantity: line.quantity,
          unitCents: line.unitCents,
          congressusOfferId: line.product.congressusProductOfferId ?? null,
        });
      }
    }
  }

  // ── Export each group as one Congressus invoice ────────────────────────────
  const results = {
    ok: true,
    exported: 0,            // SSS invoices marked EXPORTED
    congressusInvoices: 0,  // Congressus invoices created
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

    const lines: InvoiceLineItem[] = Array.from(group.lineMap.values());

    try {
      const congressusInvoiceId = await createSaleInvoice(
        group.congressusMemberId,
        lines,
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

      const hasRealProducts = lines.some((l) => l.congressusOfferId !== null);
      const fallbackCount = lines.filter((l) => l.congressusOfferId === null).length;
      console.log(
        `Exported ${group.invoiceIds.length} invoice(s) for ${group.memberName} (${group.yearMonth}) → Congressus #${congressusInvoiceId}` +
        (hasRealProducts ? ` [${lines.length - fallbackCount} product line(s)]` : "") +
        (fallbackCount > 0 ? ` [${fallbackCount} fallback line(s) without offer ID]` : "")
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
