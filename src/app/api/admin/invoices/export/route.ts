import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { createSaleInvoice, CongressusHttpError, InvoiceLineItem } from "@/lib/congressus";
import { requireAdmin } from "@/lib/auth";

// The export creates TWO separate Congressus sale invoices per member per month —
// one for SSS snacks, one for PPP drinks — from the same admin "Export" action.
// Both reuse createSaleInvoice() (and its Mendix fallback for lines without a
// Congressus offer id).
//
// Never twice: each run first CLAIMS the orders it exports — one atomic update
// CONFIRMED → EXPORTING tagged with its run id — so a concurrent run, double click
// or retry can't pick up the same orders. Per member-month group, after calling
// Congressus:
//   • success                         → EXPORTED (+ Congressus invoice id)
//   • Congressus rejected it (4xx)    → back to CONFIRMED (nothing was created)
//   • unknown (timeout, 5xx, network, crash, or our DB write failed after
//     Congressus succeeded)          → stays EXPORTING ("needs check"); an admin
//     checks Congressus and resolves it (POST /api/admin/invoices/reconcile).

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
  needsCheck: number; // orders left EXPORTING because the outcome is unknown
  errors: string[];
}
interface ClaimOps {
  markExported: (invoiceIds: string[], congressusInvoiceId: number) => Promise<void>;
  release: (invoiceIds: string[]) => Promise<void>; // back to CONFIRMED
}

function monthName(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString("nl-NL", {
    month: "long",
    year: "numeric",
  });
}

// Group by member × calendar month, aggregate lines, and create one Congressus
// invoice per group. `ops` lets each source table update its own (claimed) rows.
async function runExport(
  invoices: ExpInvoice[],
  referencePrefix: string,
  ops: ClaimOps
): Promise<ExportOutcome> {
  const out: ExportOutcome = { exported: 0, congressusInvoices: 0, failed: 0, needsCheck: 0, errors: [] };

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
    const label = `${referencePrefix} — ${g.memberName} (${g.yearMonth})`;
    let congressusInvoiceId: number | null = null;
    try {
      congressusInvoiceId = await createSaleInvoice(g.congressusMemberId, lines, reference);
      await ops.markExported(g.invoiceIds, congressusInvoiceId);
      out.exported += g.invoiceIds.length;
      out.congressusInvoices++;
      console.log(
        `[${referencePrefix}] Exported ${g.invoiceIds.length} invoice(s) for ${g.memberName} (${g.yearMonth}) → Congressus #${congressusInvoiceId}`
      );
    } catch (err) {
      out.failed++;
      console.error(`[${referencePrefix}] Export failed for ${g.memberName} (${g.yearMonth}):`, err);
      const msg = (err as Error).message;
      if (congressusInvoiceId != null) {
        // Created in Congressus, but marking it exported here failed.
        out.needsCheck += g.invoiceIds.length;
        out.errors.push(
          `${label}: created in Congressus as #${congressusInvoiceId} but not marked exported here (${msg}). ` +
            `Resolve under "Needs check" → mark exported.`
        );
      } else if (err instanceof CongressusHttpError && err.definitelyNotCreated) {
        // Rejected by Congressus — nothing created, safe to retry later.
        try {
          await ops.release(g.invoiceIds);
          out.errors.push(`${label}: ${msg} — not created, back to pending.`);
        } catch {
          out.needsCheck += g.invoiceIds.length;
          out.errors.push(`${label}: ${msg} — not created; resolve under "Needs check" → back to pending.`);
        }
      } else {
        // Timeout / 5xx / network: it may or may not exist in Congressus.
        out.needsCheck += g.invoiceIds.length;
        out.errors.push(
          `${label}: ${msg} — outcome unknown. Check Congressus for this member, then resolve under "Needs check".`
        );
      }
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

  const EMPTY: ExportOutcome = { exported: 0, congressusInvoices: 0, failed: 0, needsCheck: 0, errors: [] };
  // This run's claim tag: only orders claimed with it are exported by this request.
  const runId = randomUUID();
  const claimedAt = new Date();

  // ── SSS snacks ──────────────────────────────────────────────────────────────
  let sss = EMPTY;
  if (scope !== "ppp") {
  // Claim every pending SSS order for this run (atomic; a concurrent run gets none).
  await prisma.saleInvoice.updateMany({
    where: { status: "CONFIRMED" },
    data: { status: "EXPORTING", exportClaim: runId, exportClaimedAt: claimedAt },
  });
  const sssInvoices = await prisma.saleInvoice.findMany({
    where: { status: "EXPORTING", exportClaim: runId },
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
  sss = await runExport(sssExp, "SSS", {
    markExported: (ids, cid) =>
      prisma.saleInvoice
        .updateMany({
          where: { id: { in: ids }, exportClaim: runId },
          data: { status: "EXPORTED", exportedAt: new Date(), congressusInvoiceId: cid, exportClaim: null },
        })
        .then(() => undefined),
    release: (ids) =>
      prisma.saleInvoice
        .updateMany({
          where: { id: { in: ids }, exportClaim: runId },
          data: { status: "CONFIRMED", exportClaim: null, exportClaimedAt: null },
        })
        .then(() => undefined),
  });
  }

  // ── PPP drinks ───────────────────────────────────────────────────────────────
  let ppp = EMPTY;
  if (scope !== "sss") {
  // Each line's description includes the activity name (e.g. "Pils – Borrel 28 jun"),
  // and same product at different activities stays on separate lines.
  await prisma.pppInvoice.updateMany({
    where: { status: "CONFIRMED" },
    data: { status: "EXPORTING", exportClaim: runId, exportClaimedAt: claimedAt },
  });
  const pppInvoices = await prisma.pppInvoice.findMany({
    where: { status: "EXPORTING", exportClaim: runId },
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
  ppp = await runExport(pppExp, "PPP", {
    markExported: (ids, cid) =>
      prisma.pppInvoice
        .updateMany({
          where: { id: { in: ids }, exportClaim: runId },
          data: { status: "EXPORTED", exportedAt: new Date(), congressusInvoiceId: cid, exportClaim: null },
        })
        .then(() => undefined),
    release: (ids) =>
      prisma.pppInvoice
        .updateMany({
          where: { id: { in: ids }, exportClaim: runId },
          data: { status: "CONFIRMED", exportClaim: null, exportClaimedAt: null },
        })
        .then(() => undefined),
  });
  }

  return NextResponse.json({
    ok: sss.failed === 0 && ppp.failed === 0,
    // Combined totals (kept for the existing invoices page).
    exported: sss.exported + ppp.exported,
    congressusInvoices: sss.congressusInvoices + ppp.congressusInvoices,
    failed: sss.failed + ppp.failed,
    needsCheck: sss.needsCheck + ppp.needsCheck,
    errors: [...sss.errors, ...ppp.errors],
    // Per-system breakdown.
    sss,
    ppp,
  });
}
