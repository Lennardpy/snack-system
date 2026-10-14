import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ExternalTabView } from "./external-db";

// The downloadable statement for an external tab: title, borrel, what was drunk
// at the tab's price level, per line excl. and incl. VAT, VAT per rate, totals.
// The price level itself isn't printed (it's internal); the prices are.

const A4: [number, number] = [595.28, 841.89];
const M = 50; // page margin
const ORANGE = rgb(0.93, 0.49, 0.09);
const GREY = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.85, 0.85, 0.85);

const euro = (c: number) => `${c < 0 ? "-" : ""}€${(Math.abs(c) / 100).toFixed(2)}`;
const day = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });

// Standard PDF fonts only encode WinAnsi; replace anything else (e.g. emoji).
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const safe = (s: string) =>
  [...s].map((ch) => (ch.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRA.includes(ch) ? ch : "?")).join("");

export function externalTabTitle(tab: Pick<ExternalTabView, "title" | "cardName" | "activity">) {
  return tab.title?.trim() || `${tab.cardName} — ${tab.activity.name}`;
}

export async function renderExternalTabPdf(tab: ExternalTabView): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const title = externalTabTitle(tab);
  doc.setTitle(safe(title));
  doc.setCreator("Stress Snack System");

  const b = tab.breakdown;
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;

  const text = (s: string, x: number, size: number, f: PDFFont = font, color = rgb(0, 0, 0)) =>
    page.drawText(safe(s), { x, y, size, font: f, color });
  const right = (s: string, xRight: number, size: number, f: PDFFont = font, color = rgb(0, 0, 0)) =>
    page.drawText(safe(s), { x: xRight - f.widthOfTextAtSize(safe(s), size), y, size, font: f, color });
  const rule = (yy: number, thickness = 0.6) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: A4[0] - M, y: yy }, thickness, color: LINE });
  // Wrap a long string to a width (used for the title and drink names).
  const wrap = (s: string, size: number, f: PDFFont, width: number) => {
    const words = safe(s).split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > width && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  // ── Header ──────────────────────────────────────────────────────────────────
  text("Stress", M, 22, bold, ORANGE);
  right("Drinks statement", A4[0] - M, 11, font, GREY);
  y -= 14;
  right(`Date: ${day(new Date())}`, A4[0] - M, 9, font, GREY);
  y -= 34;
  for (const l of wrap(title, 17, bold, A4[0] - 2 * M)) {
    text(l, M, 17, bold);
    y -= 22;
  }
  y -= 2;
  text(`Borrel: ${tab.activity.name}, ${day(new Date(tab.activity.date))}`, M, 10, font, GREY);
  y -= 30;

  // ── Lines ───────────────────────────────────────────────────────────────────
  // Columns (right edges for numbers).
  const X = { name: M, qty: 270, unitEx: 335, unitIn: 400, vat: 435, totEx: 495, totIn: A4[0] - M };
  const header = () => {
    const s = 8;
    text("Drink", X.name, s, bold, GREY);
    right("Qty", X.qty, s, bold, GREY);
    right("Unit excl.", X.unitEx, s, bold, GREY);
    right("Unit incl.", X.unitIn, s, bold, GREY);
    right("VAT", X.vat, s, bold, GREY);
    right("Total excl.", X.totEx, s, bold, GREY);
    right("Total incl.", X.totIn, s, bold, GREY);
    y -= 7;
    rule(y, 0.8);
    y -= 15;
  };
  header();

  for (const l of b.lines) {
    const nameLines = wrap(l.name, 10, font, X.qty - X.name - 40);
    if (y - nameLines.length * 13 < M + 40) {
      page = doc.addPage(A4);
      y = A4[1] - M;
      header();
    }
    right(String(l.quantity), X.qty, 10);
    right(euro(l.unitExclCents), X.unitEx, 10);
    right(euro(l.unitInclCents), X.unitIn, 10);
    right(`${l.vatRate}%`, X.vat, 10, font, GREY);
    right(euro(l.totalExclCents), X.totEx, 10);
    right(euro(l.totalInclCents), X.totIn, 10, bold);
    for (const [i, nl] of nameLines.entries()) {
      text(nl, X.name, 10);
      if (i < nameLines.length - 1) y -= 13;
    }
    y -= 8;
    rule(y);
    y -= 15;
  }
  if (b.lines.length === 0) {
    text("Nothing was drunk on this tab.", X.name, 10, font, GREY);
    y -= 23;
  }

  // ── Totals ──────────────────────────────────────────────────────────────────
  const totalsHeight = 30 + 16 * (b.vatByRate.length + 2);
  if (y - totalsHeight < M) {
    page = doc.addPage(A4);
    y = A4[1] - M;
  }
  y -= 6;
  const labelX = 330;
  const row = (label: string, value: string, f: PDFFont = font, size = 10) => {
    text(label, labelX, size, f);
    right(value, X.totIn, size, f);
    y -= 16;
  };
  row("Total excl. VAT", euro(b.totalExclCents));
  for (const r of b.vatByRate) row(`VAT ${r.rate}% over ${euro(r.baseCents)}`, euro(r.vatCents));
  y += 6;
  page.drawLine({ start: { x: labelX, y }, end: { x: A4[0] - M, y }, thickness: 0.8, color: LINE });
  y -= 16;
  row("Total incl. VAT", euro(b.totalInclCents), bold, 12);

  // ── Footer on every page ────────────────────────────────────────────────────
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const s = 8;
    p.drawText("Stress · stress.utwente.nl", { x: M, y: M - 20, size: s, font, color: GREY });
    const n = `Page ${i + 1} of ${pages.length}`;
    p.drawText(n, { x: A4[0] - M - font.widthOfTextAtSize(n, s), y: M - 20, size: s, font, color: GREY });
  });

  return doc.save();
}
