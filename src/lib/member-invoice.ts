import { readFileSync } from "fs";
import { join } from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { prisma } from "./prisma";
import { periodLabel } from "./settlement";
import { ASSOCIATION_LABEL, isAssociationId, type AssociationId } from "./associations";

// A member's invoices, as the member (portal) or an admin (member page) sees them —
// so a board member can explain an invoice: what was billed, per borrel / kiosk day.
//   • Dimensie — one per export (PppExportBatch): Dimensie collects from its sheet;
//     this PDF is a statement of what was billed.      key "b-<batchId>"
//   • Stress   — one per Congressus sale invoice (snacks + drinks); the PDF is its
//     specification.                                  key "c-<association>-<id>"
// Orders exported without an invoice (only €0 lines) aren't on any.

export interface MemberInvoiceSummary {
  key: string;
  memberId: string;
  association: AssociationId;
  reference: string;
  period: string;
  date: string; // when it was exported
  totalCents: number;
  orders: number;
}

interface Section {
  title: string;
  date: Date;
  lines: { name: string; quantity: number; unitCents: number; totalCents: number }[];
  totalCents: number;
}

export interface MemberInvoiceDetail extends MemberInvoiceSummary {
  member: { firstName: string; lastName: string; email: string; studentNumber: string | null; congressusId: number | null };
  sections: Section[];
}

const AMS = "Europe/Amsterdam";

async function exportedOrders(memberIds: string[]) {
  const [ppp, sss] = await Promise.all([
    prisma.pppInvoice.findMany({
      where: { memberId: { in: memberIds }, status: "EXPORTED", OR: [{ exportBatchId: { not: null } }, { congressusInvoiceId: { not: null } }] },
      select: {
        id: true,
        memberId: true,
        totalCents: true,
        exportedAt: true,
        exportBatchId: true,
        congressusInvoiceId: true,
        exportBatch: { select: { number: true, period: true, createdAt: true } },
        member: { select: { associationId: true } },
        activity: { select: { id: true, name: true, date: true } },
        lines: { select: { quantity: true, unitCents: true, product: { select: { name: true } } } },
      },
    }),
    prisma.saleInvoice.findMany({
      where: { memberId: { in: memberIds }, status: "EXPORTED", congressusInvoiceId: { not: null } },
      select: {
        id: true,
        memberId: true,
        totalCents: true,
        exportedAt: true,
        congressusInvoiceId: true,
        confirmedAt: true,
        createdAt: true,
        member: { select: { associationId: true } },
        lines: { select: { quantity: true, unitCents: true, product: { select: { name: true } } } },
      },
    }),
  ]);
  type Order = {
    key: string;
    memberId: string;
    association: AssociationId;
    reference: string;
    batchPeriod: string | null;
    exportedAt: Date;
    totalCents: number;
    sectionKey: string;
    sectionTitle: string;
    date: Date;
    lines: { quantity: number; unitCents: number; product: { name: string } }[];
  };
  const assoc = (a: string): AssociationId => (isAssociationId(a) ? a : "stress");
  const orders: Order[] = [
    ...ppp.map((o) => ({
      key: o.exportBatchId ? `b-${o.exportBatchId}` : `c-${o.member.associationId}-${o.congressusInvoiceId}`,
      memberId: o.memberId,
      association: assoc(o.member.associationId),
      reference: o.exportBatch?.number ?? `Congressus #${o.congressusInvoiceId}`,
      batchPeriod: o.exportBatch?.period ?? null,
      exportedAt: o.exportBatch?.createdAt ?? o.exportedAt ?? o.activity.date,
      totalCents: o.totalCents,
      sectionKey: `a-${o.activity.id}`,
      sectionTitle: o.activity.name,
      date: o.activity.date,
      lines: o.lines,
    })),
    ...sss.map((o) => {
      const when = o.confirmedAt ?? o.createdAt;
      return {
        key: `c-${o.member.associationId}-${o.congressusInvoiceId}`,
        memberId: o.memberId,
        association: assoc(o.member.associationId),
        reference: `Congressus #${o.congressusInvoiceId}`,
        batchPeriod: null,
        exportedAt: o.exportedAt ?? when,
        totalCents: o.totalCents,
        sectionKey: `k-${when.toLocaleDateString("en-CA", { timeZone: AMS })}`,
        sectionTitle: "Snack kiosk",
        date: when,
        lines: o.lines,
      };
    }),
  ];
  return orders;
}

export async function memberInvoices(memberIds: string[]): Promise<MemberInvoiceSummary[]> {
  const groups = new Map<string, Awaited<ReturnType<typeof exportedOrders>>>();
  for (const o of await exportedOrders(memberIds)) groups.set(o.key, [...(groups.get(o.key) ?? []), o]);
  return [...groups.entries()]
    .map(([key, os]) => ({
      key,
      memberId: os[0].memberId,
      association: os[0].association,
      reference: os[0].reference,
      period: os[0].batchPeriod ?? periodLabel(os.map((o) => o.date)),
      date: os[0].exportedAt.toISOString(),
      totalCents: os.reduce((s, o) => s + o.totalCents, 0),
      orders: os.length,
    }))
    .filter((i) => i.totalCents > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// One invoice of these members (null if it isn't theirs).
export async function memberInvoice(memberIds: string[], key: string): Promise<MemberInvoiceDetail | null> {
  const os = (await exportedOrders(memberIds)).filter((o) => o.key === key);
  if (os.length === 0) return null;
  const member = await prisma.member.findUnique({
    where: { id: os[0].memberId },
    select: { firstName: true, lastName: true, email: true, studentNumber: true, congressusId: true },
  });
  if (!member) return null;

  const sections = new Map<string, Section>();
  for (const o of os) {
    const sec = sections.get(o.sectionKey) ?? { title: o.sectionTitle, date: o.date, lines: [], totalCents: 0 };
    for (const l of o.lines) {
      const line = sec.lines.find((x) => x.name === l.product.name && x.unitCents === l.unitCents);
      if (line) {
        line.quantity += l.quantity;
        line.totalCents += l.quantity * l.unitCents;
      } else {
        sec.lines.push({ name: l.product.name, quantity: l.quantity, unitCents: l.unitCents, totalCents: l.quantity * l.unitCents });
      }
    }
    sec.totalCents += o.totalCents;
    if (o.date < sec.date) sec.date = o.date;
    sections.set(o.sectionKey, sec);
  }
  return {
    key,
    memberId: os[0].memberId,
    association: os[0].association,
    reference: os[0].reference,
    period: os[0].batchPeriod ?? periodLabel(os.map((o) => o.date)),
    date: os[0].exportedAt.toISOString(),
    totalCents: os.reduce((s, o) => s + o.totalCents, 0),
    orders: os.length,
    member,
    sections: [...sections.values()].sort((a, b) => a.date.getTime() - b.date.getTime()),
  };
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const A4: [number, number] = [595.28, 841.89];
const M = 50;
const GREY = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.85, 0.85, 0.85);
const SHADE = rgb(0.96, 0.96, 0.96);
const LOGO: Record<AssociationId, string> = { stress: "stress-logo-hex.png", dimensie: "dimensie-logo.png" };
const FULL_NAME: Record<AssociationId, string> = {
  stress: "Studievereniging Stress",
  dimensie: "Studievereniging Dimensie",
};
// Stress bills through Congressus (prices incl. VAT); Dimensie collects from its
// own sheet, without VAT.
const NOTE: Record<AssociationId, string> = {
  stress: "Prices incl. VAT. Collected by direct debit through Congressus.",
  dimensie: "No VAT. Collected by Dimensie by direct debit.",
};

const euro = (c: number) => `${c < 0 ? "-" : ""}€${(Math.abs(c) / 100).toFixed(2)}`;
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: AMS });
const shortDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: AMS });
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const safe = (s: string) => [...s].map((ch) => (ch.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRA.includes(ch) ? ch : "?")).join("");

export async function renderMemberInvoicePdf(inv: MemberInvoiceDetail): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const name = ASSOCIATION_LABEL[inv.association];
  const memberName = `${inv.member.firstName} ${inv.member.lastName}`.trim();
  doc.setTitle(safe(`${name} invoice ${inv.reference} — ${memberName}`));
  doc.setCreator(`${name} PPP`);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const W = A4[0] - M;
  const text = (t: string, x: number, size: number, f: PDFFont = font, color = rgb(0, 0, 0)) =>
    page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, xRight: number, size: number, f: PDFFont = font, color = rgb(0, 0, 0)) =>
    page.drawText(safe(t), { x: xRight - f.widthOfTextAtSize(safe(t), size), y, size, font: f, color });
  const rule = (thickness = 0.6) => page.drawLine({ start: { x: M, y }, end: { x: W, y }, thickness, color: LINE });
  const ensure = (needed: number) => {
    if (y - needed < M + 20) {
      page = doc.addPage(A4);
      y = A4[1] - M;
    }
  };

  // ── Header: the association's logo (its name if the file is missing) ─────────
  let logo: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
  try {
    logo = await doc.embedPng(readFileSync(join(process.cwd(), "public", LOGO[inv.association])));
  } catch {
    logo = null;
  }
  if (logo) {
    const h = 58;
    const w = Math.min((logo.width / logo.height) * h, 180);
    page.drawImage(logo, { x: M, y: y - h + 14, width: w, height: (w / logo.width) * logo.height });
  } else {
    text(name, M, 22, bold);
  }
  right(inv.association === "stress" ? "INVOICE SPECIFICATION" : "STATEMENT", W, 13, bold);
  y -= 15;
  right(`Reference ${inv.reference}`, W, 9, font, GREY);
  y -= 12;
  right(`Date ${day(new Date(inv.date))}`, W, 9, font, GREY);
  y -= 46;

  const top = y;
  text("From", M, 8, bold, GREY);
  y -= 12;
  text(FULL_NAME[inv.association], M, 9);
  y = top;
  text("To", 320, 8, bold, GREY);
  y -= 12;
  for (const l of [
    memberName,
    inv.member.email,
    ...(inv.member.studentNumber ? [`Student number ${inv.member.studentNumber}`] : []),
  ]) {
    text(l, 320, 9);
    y -= 12;
  }
  y -= 16;
  text(`${inv.association === "stress" ? "Snacks & drinks" : "Drink costs"} ${inv.period}`, M, 14, bold);
  y -= 26;

  // ── Per borrel / kiosk day ───────────────────────────────────────────────────
  const P = { name: M + 14, qty: 380, unit: 460, total: W };
  for (const sec of inv.sections) {
    ensure(40 + 12 * sec.lines.length);
    text(`${sec.title} — ${shortDay(sec.date)}`, M, 10.5, bold);
    right(euro(sec.totalCents), P.total, 10.5, bold);
    y -= 14;
    for (const l of sec.lines) {
      text(l.name, P.name, 9, font, GREY);
      right(`${l.quantity}×`, P.qty, 9, font, GREY);
      right(euro(l.unitCents), P.unit, 9, font, GREY);
      right(euro(l.totalCents), P.total, 9, font, GREY);
      y -= 12;
    }
    y -= 4;
    rule();
    y -= 14;
  }

  ensure(60);
  y -= 4;
  page.drawRectangle({ x: M, y: y - 8, width: W - M, height: 26, color: SHADE });
  text("Total", M + 8, 12, bold);
  right(euro(inv.totalCents), W - 8, 12, bold);
  y -= 34;
  text(NOTE[inv.association], M, 9, font, GREY);
  y -= 12;
  text("Discounts (roles, free drinks) are already included in the prices above.", M, 9, font, GREY);

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const footer = safe(`${name} · ${inv.reference} · ${memberName}`);
    p.drawText(footer, { x: M, y: M - 20, size: 8, font, color: GREY });
    const n = `Page ${i + 1} of ${pages.length}`;
    p.drawText(n, { x: W - font.widthOfTextAtSize(n, 8), y: M - 20, size: 8, font, color: GREY });
  });
  return doc.save();
}

export const invoiceFileName = (inv: MemberInvoiceDetail) =>
  `${inv.reference.replace(/[^A-Za-z0-9-]+/g, "")}-${inv.member.lastName.replace(/[^A-Za-z0-9-]+/g, "") || "member"}.pdf`;
