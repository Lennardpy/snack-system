import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSaleInvoice, InvoiceLineItem } from "@/lib/congressus";
import { requireAdmin } from "@/lib/auth";

// The export creates TWO separate Congressus sale invoices per member per month —
// one for SSS snacks, one for PPP drinks — from the same admin "Export" action.
// Both reuse createSaleInvoice() (and its Mendix fallback for lines without a
// Congressus offer id).

interface ExpLine {
  aggKey: string; // de-dup key within a member-month
  description: string; // becomes the Congressus line description / productName
  quantity: number;
  unitCents: number;
  congressusOfferId: number | null;
}
interface ExpInvoice {
  id: string;
  memberId: string;
  congressusMemberId: number;
  memberName: string;
  when: Date;
  lines: ExpLine[];
}
interface ExportOutcome {
  exported: number; // source invoices marked EXPORTED
  congressusInvoices: number; // Congressus invoices created
  failed: number;
  errors: string[];
}

function monthName(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString("nl-NL", {
    month: "long",
    year: "numeric",
  });
}

// Group by member × calendar month, aggregate lines, and create one Congressus
// invoice per group. `markExported` lets each source table update its own rows.
async function runExport(
  invoices: ExpInvoice[],
  referencePrefix: string,
  markExported: (invoiceIds: string[], congressusInvoiceId: number) => Promise<void>
): Promise<ExportOutcome> {
  const out: ExportOutcome = { exported: 0, congressusInvoices: 0, failed: 0, errors: [] };

  type Group = {
    congressusMemberId: number;
    memberName: string;
    yearMonth: string;
    invoiceIds: string[];
    lineMap: Map<string, InvoiceLineItem>;
  };
  const groups = new Map<string, Group>();

  for (const inv of invoices) {
    const d = inv.when;
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const key = `${inv.memberId}-${yearMonth}`;
    if (!groups.has(key)) {
      groups.set(key, {
        congressusMemberId: inv.congressusMemberId,
        memberName: inv.memberName,
        yearMonth,
        invoiceIds: [],
        lineMap: new Map(),
      });
    }
    const g = groups.get(key)!;
    g.invoiceIds.push(inv.id);
    for (const line of inv.lines) {
      const existing = g.lineMap.get(line.aggKey);
      if (existing) {
        existing.quantity += line.quantity;
      } else {
        g.lineMap.set(line.aggKey, {
          productName: line.description,
          quantity: line.quantity,
          unitCents: line.unitCents,
          congressusOfferId: line.congressusOfferId,
        });
      }
    }
  }

  for (const g of groups.values()) {
    const reference = `${referencePrefix} ${monthName(g.yearMonth)}`;
    const lines = Array.from(g.lineMap.values());
    try {
      const congressusInvoiceId = await createSaleInvoice(g.congressusMemberId, lines, reference);
      await markExported(g.invoiceIds, congressusInvoiceId);
      out.exported += g.invoiceIds.length;
      out.congressusInvoices++;
      console.log(
        `[${referencePrefix}] Exported ${g.invoiceIds.length} invoice(s) for ${g.memberName} (${g.yearMonth}) → Congressus #${congressusInvoiceId}`
      );
    } catch (err) {
      out.failed++;
      out.errors.push(`${referencePrefix} — ${g.memberName} (${g.yearMonth}): ${(err as Error).message}`);
      console.error(`[${referencePrefix}] Export failed for ${g.memberName} (${g.yearMonth}):`, err);
    }
  }

  return out;
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Optional { scope: "sss" | "ppp" | "all" } so each invoices page exports only
  // its own type. Defaults to "all" (e.g. an empty body) for back-compat.
  let scope: "sss" | "ppp" | "all" = "all";
  try {
    const body = await req.json();
    if (body?.scope === "sss" || body?.scope === "ppp") scope = body.scope;
  } catch {
    /* no body → export all */
  }

  const EMPTY: ExportOutcome = { exported: 0, congressusInvoices: 0, failed: 0, errors: [] };

  // ── SSS snacks ──────────────────────────────────────────────────────────────
  let sss = EMPTY;
  if (scope !== "ppp") {
  const sssInvoices = await prisma.saleInvoice.findMany({
    where: { status: "CONFIRMED" },
    include: { member: true, lines: { include: { product: true } } },
    orderBy: { confirmedAt: "asc" },
  });
  const sssExp: ExpInvoice[] = sssInvoices.map((inv) => ({
    id: inv.id,
    memberId: inv.memberId,
    congressusMemberId: inv.member.congressusId,
    memberName: `${inv.member.firstName} ${inv.member.lastName}`,
    when: inv.confirmedAt ?? inv.createdAt,
    lines: inv.lines.map((l) => ({
      aggKey: `${l.productId}-${l.unitCents}`,
      description: l.product.name,
      quantity: l.quantity,
      unitCents: l.unitCents,
      congressusOfferId: l.product.congressusProductOfferId ?? null,
    })),
  }));
  sss = await runExport(sssExp, "SSS", (ids, cid) =>
    prisma.saleInvoice
      .updateMany({
        where: { id: { in: ids } },
        data: { status: "EXPORTED", exportedAt: new Date(), congressusInvoiceId: cid },
      })
      .then(() => undefined)
  );
  }

  // ── PPP drinks ───────────────────────────────────────────────────────────────
  let ppp = EMPTY;
  if (scope !== "sss") {
  // Each line's description includes the activity name (e.g. "Pils – Borrel 28 jun"),
  // and same product at different activities stays on separate lines.
  const pppInvoices = await prisma.pppInvoice.findMany({
    where: { status: "CONFIRMED" },
    include: { member: true, activity: true, lines: { include: { product: true } } },
    orderBy: { confirmedAt: "asc" },
  });
  const pppExp: ExpInvoice[] = pppInvoices.map((inv) => ({
    id: inv.id,
    memberId: inv.memberId,
    congressusMemberId: inv.member.congressusId,
    memberName: `${inv.member.firstName} ${inv.member.lastName}`,
    when: inv.confirmedAt,
    lines: inv.lines.map((l) => ({
      aggKey: `${l.productId}-${l.unitCents}-${inv.activityId}`,
      description: `${l.product.name} – ${inv.activity.name}`,
      quantity: l.quantity,
      unitCents: l.unitCents,
      congressusOfferId: l.product.congressusProductOfferId ?? null,
    })),
  }));
  ppp = await runExport(pppExp, "PPP", (ids, cid) =>
    prisma.pppInvoice
      .updateMany({
        where: { id: { in: ids } },
        data: { status: "EXPORTED", exportedAt: new Date(), congressusInvoiceId: cid },
      })
      .then(() => undefined)
  );
  }

  return NextResponse.json({
    ok: sss.failed === 0 && ppp.failed === 0,
    // Combined totals (kept for the existing invoices page).
    exported: sss.exported + ppp.exported,
    congressusInvoices: sss.congressusInvoices + ppp.congressusInvoices,
    failed: sss.failed + ppp.failed,
    errors: [...sss.errors, ...ppp.errors],
    // Per-system breakdown.
    sss,
    ppp,
  });
}
