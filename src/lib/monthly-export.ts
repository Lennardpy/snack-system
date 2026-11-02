import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ASSOCIATION_IDS, ASSOCIATION_LABEL, type AssociationId } from "./associations";
import { exportAssociation } from "./export-run";
import { sendMonthlyExportEmail } from "./email";
import { siteOrigin } from "./site";

// The automatic month-end export (Phase 7). Triggered on the 1st of the month at
// 12:00 Amsterdam time (POST /api/cron/monthly-export, from a Railway cron job), it
// bills the previous month for every association, exactly like the export button
// but limited to:
//   • orders placed before the 1st 00:00, and
//   • borrels that are CLOSED — a borrel still open waits for the next month.
// One run per month (MonthlyExportRun.period is unique). Afterwards each
// association's treasurer gets a summary by email, with a copy to the operator.

const AMS = "Europe/Amsterdam";

// Amsterdam calendar parts of a moment.
function amsParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: AMS,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute };
}

// 00:00 Amsterdam on the 1st of the given month, as an instant.
function amsMonthStart(year: number, month: number): Date {
  const guess = Date.UTC(year, month - 1, 1);
  const p = amsParts(new Date(guess));
  const offsetMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;
  return new Date(guess - offsetMs);
}

// Whether `now` is the scheduled moment: the 1st, 12:xx Amsterdam. The cron job
// fires at 10:00 and 11:00 UTC (12:00 in summer / winter time); only one matches.
export function isScheduledMoment(now = new Date()) {
  const p = amsParts(now);
  return p.day === 1 && p.hour === 12;
}

// The month to bill when running at `now`: the previous calendar month, cut off at
// the start of the current one.
export function billingPeriod(now = new Date()) {
  const p = amsParts(now);
  const cutoff = amsMonthStart(p.year, p.month);
  const prev = p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 };
  const period = `${prev.year}-${String(prev.month).padStart(2, "0")}`;
  const label = new Date(Date.UTC(prev.year, prev.month - 1, 15)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
  return { cutoff, period, label };
}

export interface AssociationOutcome {
  association: AssociationId;
  ok: boolean;
  body: Record<string, unknown>;
  // Borrels still open with unbilled orders of this association's members.
  waiting: { name: string; date: string; orders: number }[];
}

export async function runMonthlyExport(now = new Date()) {
  const { cutoff, period, label } = billingPeriod(now);

  // Claim the month — a second trigger (retry, overlap) stops here.
  let run;
  try {
    run = await prisma.monthlyExportRun.create({ data: { period } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { skipped: `The export for ${label} already ran.`, period };
    }
    throw err;
  }

  const outcomes: AssociationOutcome[] = [];
  for (const association of ASSOCIATION_IDS) {
    let ok = false;
    let body: Record<string, unknown>;
    try {
      const result = await exportAssociation(association, null, cutoff);
      body = result.body;
      ok = result.status === 200 && !result.body.error && result.body.ok !== false;
    } catch (err) {
      console.error(`[monthly-export] ${association} failed`, err);
      body = { error: (err as Error).message };
    }
    outcomes.push({ association, ok, body, waiting: await waitingBorrels(association, cutoff) });
  }

  await prisma.monthlyExportRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), result: outcomes as unknown as Prisma.InputJsonValue },
  });

  // Emails never undo the export; a failure is logged and recorded.
  let emailed = true;
  for (const o of outcomes) {
    try {
      await sendMonthlyExportEmail(recipients(o.association), monthlyEmail(o, label));
    } catch (err) {
      emailed = false;
      console.error(`[monthly-export] email for ${o.association} failed`, err);
    }
  }
  await prisma.monthlyExportRun.update({ where: { id: run.id }, data: { emailed } });

  return { period, label, outcomes, emailed };
}

// Open borrels before the cut-off that still hold unbilled orders of this
// association's members — they're billed next month, once closed.
async function waitingBorrels(association: AssociationId, cutoff: Date) {
  const rows = await prisma.pppInvoice.groupBy({
    by: ["activityId"],
    where: {
      status: "CONFIRMED",
      member: { associationId: association },
      activity: { status: "OPEN", date: { lt: cutoff } },
    },
    _count: true,
  });
  if (rows.length === 0) return [];
  const acts = await prisma.pppActivity.findMany({
    where: { id: { in: rows.map((r) => r.activityId) } },
    select: { id: true, name: true, date: true },
  });
  return acts
    .map((a) => ({
      name: a.name,
      date: a.date.toISOString(),
      orders: rows.find((r) => r.activityId === a.id)?._count ?? 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Who gets the summary: the association's treasurer, plus the operator in copy.
// Overridable per environment (comma-separated; "off" = none).
const DEFAULT_TO: Record<AssociationId, string> = {
  stress: "treasurer@stress.utwente.nl",
  dimensie: "treasurer@svdimensie.nl",
};
const DEFAULT_CC = "lennard@stress.utwente.nl";

function list(v: string | undefined, fallback: string) {
  const raw = (v ?? fallback).trim();
  return raw === "off" ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function recipients(association: AssociationId) {
  return {
    to: list(process.env[`MONTHLY_EXPORT_TO_${association.toUpperCase()}`], DEFAULT_TO[association]),
    cc: list(process.env.MONTHLY_EXPORT_CC, DEFAULT_CC),
  };
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Subject + HTML of one association's summary. No personal data (no names, IBANs) —
// the details are behind the admin login.
export function monthlyEmail(o: AssociationOutcome, label: string) {
  const name = ASSOCIATION_LABEL[o.association];
  const b = o.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const admin = `${siteOrigin("ppp")}/ppp/admin`;
  const lines: string[] = [];
  let headline: string;

  if (b.error) {
    headline = `⚠️ The ${name} export for ${label} failed`;
    lines.push(`Error: ${esc(String(b.error))}`, "Nothing was billed. Run the export by hand from the invoices page once it's fixed.");
  } else if (o.association === "dimensie") {
    if (b.sheet) {
      headline = `${name}: export sheet for ${label} is ready`;
      lines.push(
        `Sheet <b>${esc(b.sheet.number)}</b>: ${b.sheet.members} member(s), ${euro(b.sheet.totalCents)} in total (${b.exported} order(s), no VAT).`,
        `Download it under <a href="${admin}/invoices">Invoices → Dimensie exports</a> and collect from your members.`
      );
      if (b.specification) lines.push(`Stress's specification <b>${esc(b.specification)}</b> for the joint borrels was created; Stress's treasurer sends it with their invoice.`);
    } else {
      headline = `${name}: nothing to bill for ${label}`;
      lines.push("There were no unbilled drinks of Dimensie members at closed borrels.");
    }
  } else {
    headline = b.failed
      ? `⚠️ ${name} export for ${label}: ${b.failed} member(s) not billed`
      : b.congressusInvoices
        ? `${name}: ${b.congressusInvoices} invoice(s) for ${label} created in Congressus`
        : `${name}: nothing to bill for ${label}`;
    lines.push(
      `${b.congressusInvoices ?? 0} Congressus invoice(s), ${euro(b.billedCents ?? 0)} in total, covering ${b.sssOrders ?? 0} snack and ${b.pppOrders ?? 0} drink order(s).`
    );
    if (b.nothingToPay) lines.push(`${b.nothingToPay} member(s) only had free (€0) orders — no invoice.`);
    if (b.failed) lines.push(`${b.failed} member(s) couldn't be billed and are back to pending — see the problems below; run the export by hand once fixed.`);
    if (b.needsCheck) lines.push(`⚠️ <b>${b.needsCheck} order(s) need a check</b> — Congressus didn't answer clearly. See <a href="${admin}/invoices">Invoices</a>.`);
  }
  if (Array.isArray(b.errors) && b.errors.length) {
    lines.push(`Problems:<br>${b.errors.map((e: string) => `• ${esc(e)}`).join("<br>")}`);
  }
  if (o.waiting.length) {
    lines.push(
      `Waiting for next month — borrel(s) still open: ${o.waiting
        .map((w) => `${esc(w.name)} (${new Date(w.date).toLocaleDateString("en-GB", { timeZone: AMS })}, ${w.orders} order(s))`)
        .join(", ")}. Close them so they're billed next time.`
    );
  }
  if (o.association === "stress" && !b.error) {
    lines.push(`Specifications to Dimensie, if any: <a href="${admin}/settlements">To Dimensie</a>.`);
  }

  const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
  <h2 style="margin-bottom:4px">${esc(headline)}</h2>
  <p style="color:#6b7280;margin-top:0">Automatic month-end export · ${esc(label)}</p>
  ${lines.map((l) => `<p>${l}</p>`).join("\n  ")}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="color:#9ca3af;font-size:12px">PPP — sent automatically after the export on the 1st of the month.</p>
</div>`;
  return { subject: headline, html };
}
