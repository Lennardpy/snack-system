import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { createSaleInvoice, CongressusHttpError, InvoiceLineItem } from "@/lib/congressus";
import { requireAdmin } from "@/lib/auth";

// One combined export: ONE Congressus sale invoice per member per calendar month,
// holding both their SSS snack lines and their PPP drink lines (reference
// "SSS & PPP <month>"). One invoice → one direct debit per member, instead of
// separate SSS and PPP invoices. Every line keeps its own Congressus product offer,
// so revenue per product stays correct. Reuses createSaleInvoice() (and its Mendix
// fallback for lines without a Congressus offer id).
//
// Never twice: the run first CLAIMS the orders it exports from both tables — one
// atomic update each, CONFIRMED → EXPORTING tagged with this run's id — so a
// concurrent run, double click or retry can't pick up the same orders. Per
// member-month group, after calling Congressus:
//   • success                         → EXPORTED (+ Congressus invoice id)
//   • Congressus rejected it (4xx)    → back to CONFIRMED (nothing was created)
//   • unknown (timeout, 5xx, network, crash, or our DB write failed after
//     Congressus succeeded)          → stays EXPORTING ("needs check"); an admin
//     checks Congressus and resolves the whole group at once
//     (POST /api/admin/invoices/reconcile).

type System = "sss" | "ppp";

interface ExpLine {
  aggKey: string; // de-dup key within a member-month
  description: string; // becomes the Congressus line description / productName
  quantity: number;
  unitCents: number;
  congressusOfferId: number | null;
}
interface ExpInvoice {
  system: System;
  id: string;
  memberId: string;
  congressusMemberId: number;
  memberName: string;
  when: Date;
  lines: ExpLine[];
}
interface Group {
  congressusMemberId: number;
  memberName: string;
  yearMonth: string;
  ids: Record<System, string[]>;
  lineMap: Map<string, InvoiceLineItem>;
}

const REFERENCE_PREFIX = "SSS & PPP";

function monthName(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString("nl-NL", {
    month: "long",
    year: "numeric",
  });
}

// Set a group's claimed orders (in both tables) to EXPORTED or back to CONFIRMED.
// Only rows still claimed by this run are touched.
async function settle(
  runId: string,
  ids: Record<System, string[]>,
  outcome: { exported: number } | "release"
) {
  const data =
    outcome === "release"
      ? { status: "CONFIRMED" as const, exportClaim: null, exportClaimedAt: null }
      : {
          status: "EXPORTED" as const,
          exportedAt: new Date(),
          congressusInvoiceId: outcome.exported,
          exportClaim: null,
        };
  await prisma.$transaction([
    prisma.saleInvoice.updateMany({ where: { id: { in: ids.sss }, exportClaim: runId }, data }),
    prisma.pppInvoice.updateMany({ where: { id: { in: ids.ppp }, exportClaim: runId }, data }),
  ]);
}

export async function POST() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Claim every pending SSS and PPP order for this run ───────────────────────
  const runId = randomUUID();
  const claim = { status: "EXPORTING" as const, exportClaim: runId, exportClaimedAt: new Date() };
  await prisma.$transaction([
    prisma.saleInvoice.updateMany({ where: { status: "CONFIRMED" }, data: claim }),
    prisma.pppInvoice.updateMany({ where: { status: "CONFIRMED" }, data: claim }),
  ]);

  const [sssInvoices, pppInvoices] = await Promise.all([
    prisma.saleInvoice.findMany({
      where: { status: "EXPORTING", exportClaim: runId },
      include: { member: true, lines: { include: { product: true } } },
      orderBy: { confirmedAt: "asc" },
    }),
    prisma.pppInvoice.findMany({
      where: { status: "EXPORTING", exportClaim: runId },
      include: { member: true, activity: true, lines: { include: { product: true } } },
      orderBy: { confirmedAt: "asc" },
    }),
  ]);

  const all: ExpInvoice[] = [
    ...sssInvoices.map((inv) => ({
      system: "sss" as const,
      id: inv.id,
      memberId: inv.memberId,
      congressusMemberId: inv.member.congressusId,
      memberName: `${inv.member.firstName} ${inv.member.lastName}`,
      when: inv.confirmedAt ?? inv.createdAt,
      lines: inv.lines.map((l) => ({
        aggKey: `sss-${l.productId}-${l.unitCents}`,
        description: l.product.name,
        quantity: l.quantity,
        unitCents: l.unitCents,
        congressusOfferId: l.product.congressusProductOfferId ?? null,
      })),
    })),
    // Drink lines include the borrel name (e.g. "Pils – Weekly drink"); the same
    // drink at different borrels stays on separate lines.
    ...pppInvoices.map((inv) => ({
      system: "ppp" as const,
      id: inv.id,
      memberId: inv.memberId,
      congressusMemberId: inv.member.congressusId,
      memberName: `${inv.member.firstName} ${inv.member.lastName}`,
      when: inv.confirmedAt,
      lines: inv.lines.map((l) => ({
        aggKey: `ppp-${l.productId}-${l.unitCents}-${inv.activityId}`,
        description: `${l.product.name} – ${inv.activity.name}`,
        quantity: l.quantity,
        unitCents: l.unitCents,
        congressusOfferId: l.product.congressusProductOfferId ?? null,
      })),
    })),
  ];

  // ── Group by member × calendar month (snacks first, then drinks) ─────────────
  const groups = new Map<string, Group>();
  for (const inv of all) {
    const d = inv.when;
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const key = `${inv.memberId}-${yearMonth}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        congressusMemberId: inv.congressusMemberId,
        memberName: inv.memberName,
        yearMonth,
        ids: { sss: [], ppp: [] },
        lineMap: new Map(),
      };
      groups.set(key, g);
    }
    g.ids[inv.system].push(inv.id);
    for (const line of inv.lines) {
      const existing = g.lineMap.get(line.aggKey);
      if (existing) existing.quantity += line.quantity;
      else
        g.lineMap.set(line.aggKey, {
          productName: line.description,
          quantity: line.quantity,
          unitCents: line.unitCents,
          congressusOfferId: line.congressusOfferId,
        });
    }
  }

  // ── One Congressus invoice per group ─────────────────────────────────────────
  const out = {
    sssOrders: 0, // SSS orders marked EXPORTED
    pppOrders: 0, // PPP orders marked EXPORTED
    congressusInvoices: 0,
    failed: 0,
    needsCheck: 0, // orders left EXPORTING because the outcome is unknown
    errors: [] as string[],
  };

  for (const g of groups.values()) {
    const reference = `${REFERENCE_PREFIX} ${monthName(g.yearMonth)}`;
    const label = `${g.memberName} (${g.yearMonth})`;
    const orders = g.ids.sss.length + g.ids.ppp.length;
    let congressusInvoiceId: number | null = null;
    try {
      congressusInvoiceId = await createSaleInvoice(
        g.congressusMemberId,
        Array.from(g.lineMap.values()),
        reference
      );
      await settle(runId, g.ids, { exported: congressusInvoiceId });
      out.sssOrders += g.ids.sss.length;
      out.pppOrders += g.ids.ppp.length;
      out.congressusInvoices++;
      console.log(
        `[export] ${label}: ${g.ids.sss.length} SSS + ${g.ids.ppp.length} PPP order(s) → Congressus #${congressusInvoiceId}`
      );
    } catch (err) {
      out.failed++;
      console.error(`[export] Failed for ${label}:`, err);
      const msg = (err as Error).message;
      if (congressusInvoiceId != null) {
        // Created in Congressus, but marking it exported here failed.
        out.needsCheck += orders;
        out.errors.push(
          `${label}: created in Congressus as #${congressusInvoiceId} but not marked exported here (${msg}). ` +
            `Resolve under "needs a check" → mark exported.`
        );
      } else if (err instanceof CongressusHttpError && err.definitelyNotCreated) {
        // Rejected by Congressus — nothing created, safe to retry later.
        try {
          await settle(runId, g.ids, "release");
          out.errors.push(`${label}: ${msg} — not created, back to pending.`);
        } catch {
          out.needsCheck += orders;
          out.errors.push(`${label}: ${msg} — not created; resolve under "needs a check" → back to pending.`);
        }
      } else {
        // Timeout / 5xx / network: it may or may not exist in Congressus.
        out.needsCheck += orders;
        out.errors.push(
          `${label}: ${msg} — outcome unknown. Check Congressus for this member, then resolve under "needs a check".`
        );
      }
    }
  }

  return NextResponse.json({
    ok: out.failed === 0,
    exported: out.sssOrders + out.pppOrders,
    ...out,
  });
}
