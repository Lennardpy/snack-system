import { readFileSync } from "fs";
import { join } from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SettlementSnapshot } from "./settlement";
import { vatLabel, vatSummary } from "./vat";

// The specification that goes WITH the invoice Stress's treasurer makes for
// Dimensie (the system doesn't make or send the invoice itself): what Dimensie
// members drank at joint borrels in the month, so the totals can be followed:
// per borrel, each member with the drinks they had there (qty, price, VAT
// category) and their subtotal, the borrel's subtotal — and at the end the total,
// with VAT per category (always VL 9% and VH 21%).
// Prices are the drink prices before Dimensie's own member discounts, incl. VAT;
// bartenders' free drinks aren't on it. Header lines from env (split on "|"):
//   SETTLEMENT_FROM  e.g. "Studievereniging Stress|Ravelijn 1336|…"
//   SETTLEMENT_TO    e.g. "Studievereniging Dimensie|Hallenweg 8|…"

const A4: [number, number] = [595.28, 841.89];
const M = 50;
const ORANGE = rgb(0.93, 0.49, 0.09);
const GREY = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.85, 0.85, 0.85);
const SHADE = rgb(0.96, 0.96, 0.96);

const euro = (c: number) => `${c < 0 ? "-" : ""}€${(Math.abs(c) / 100).toFixed(2)}`;
const day = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
const shortDay = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Amsterdam" });
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const safe = (s: string) =>
  [...s].map((ch) => (ch.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRA.includes(ch) ? ch : "?")).join("");
const envLines = (name: string, fallback: string) =>
  (process.env[name] ?? fallback).split("|").map((s) => s.trim()).filter(Boolean);

export async function renderSettlementPdf(s: {
  number: string;
  createdAt: Date;
  status: string;
  snapshot: SettlementSnapshot;
}): Promise<Uint8Array> {
  const snap = s.snapshot;
  const b = snap.breakdown;
  const label = snap.periodLabel ?? snap.monthLabel ?? "";
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(safe(`Specification ${s.number}`));
  doc.setCreator("Stress PPP");

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const W = A4[0] - M;
  const text = (t: string, x: number, size: number, f: PDFFont = font, color = rgb(0, 0, 0)) =>
    page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, xRight: number, size: number, f: PDFFont = font, color = rgb(0, 0, 0)) =>
    page.drawText(safe(t), { x: xRight - f.widthOfTextAtSize(safe(t), size), y, size, font: f, color });
  const fit = (t: string, width: number, size: number, f: PDFFont = font) => {
    let out = safe(t);
    while (out.length > 1 && f.widthOfTextAtSize(out, size) > width) out = out.slice(0, -2) + "…";
    return out;
  };
  const rule = (thickness = 0.6) =>
    page.drawLine({ start: { x: M, y }, end: { x: W, y }, thickness, color: LINE });
  const newPage = () => {
    page = doc.addPage(A4);
    y = A4[1] - M;
  };
  const ensure = (needed: number, onNew?: () => void) => {
    if (y - needed < M + 20) {
      newPage();
      onNew?.();
    }
  };

  // ── Header ──────────────────────────────────────────────────────────────────
  // The Stress logo (public/stress-logo-hex.png); the name in orange if missing.
  let logo: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
  try {
    logo = await doc.embedPng(readFileSync(join(process.cwd(), "public", "stress-logo-hex.png")));
  } catch {
    logo = null;
  }
  if (logo) {
    const h = 62;
    page.drawImage(logo, { x: M, y: y - h + 14, width: (logo.width / logo.height) * h, height: h });
  } else {
    text("Stress", M, 22, bold, ORANGE);
  }
  right("SPECIFICATION", W, 13, bold);
  y -= 15;
  right(`Reference ${s.number}`, W, 9, font, GREY);
  y -= 12;
  right(`Date ${day(s.createdAt)}`, W, 9, font, GREY);
  y -= logo ? 40 : 26;
  const from = envLines("SETTLEMENT_FROM", "Studievereniging Stress");
  const to = envLines("SETTLEMENT_TO", "Studievereniging Dimensie");
  const top = y;
  text("From", M, 8, bold, GREY);
  y -= 12;
  for (const l of from) {
    text(l, M, 9);
    y -= 12;
  }
  const afterFrom = y;
  y = top;
  text("For", 320, 8, bold, GREY);
  y -= 12;
  for (const l of to) {
    text(l, 320, 9);
    y -= 12;
  }
  y = Math.min(afterFrom, y) - 16;
  text(`Drinks of Dimensie members at joint borrels — ${label}`, M, 14, bold);
  y -= 29;

  // ── Per borrel: each member with the drinks they had there ──────────────────
  const P = { drink: M + 14, qty: 360, unit: 425, vat: 485, total: W };
  const columns = () => {
    text("Drink", P.drink, 8, bold, GREY);
    right("Qty", P.qty, 8, bold, GREY);
    right("Unit incl.", P.unit, 8, bold, GREY);
    right("VAT", P.vat, 8, bold, GREY);
    right("Total incl.", P.total, 8, bold, GREY);
    y -= 6;
    rule(0.8);
    y -= 14;
  };
  const purchases = snap.purchases ?? [];
  const byBorrel = new Map<string, typeof purchases>();
  for (const p of purchases) {
    const key = `${p.date}|${p.borrel}`;
    byBorrel.set(key, [...(byBorrel.get(key) ?? []), p]);
  }
  for (const rows of byBorrel.values()) {
    const title = `${rows[0].borrel} — ${shortDay(new Date(rows[0].date))}`;
    const borrelHeader = (more = "") => {
      text(title + more, M, 11, bold);
      y -= 16;
      columns();
    };
    ensure(80);
    borrelHeader();
    const byMember = new Map<string, typeof rows>();
    for (const p of rows) byMember.set(p.member, [...(byMember.get(p.member) ?? []), p]);
    for (const [member, items] of byMember) {
      // Keep a member's name with their drinks.
      ensure(16 + 13 * items.length + 6, () => borrelHeader(" (continued)"));
      text(fit(member, P.qty - M - 40, 9.5, bold), M, 9.5, bold);
      right(euro(items.reduce((sum, p) => sum + p.totalInclCents, 0)), P.total, 9.5, bold);
      y -= 13;
      for (const p of items) {
        text(fit(p.drink, P.qty - P.drink - 25, 9), P.drink, 9, font, GREY);
        right(String(p.quantity), P.qty, 9, font, GREY);
        right(euro(p.unitInclCents), P.unit, 9, font, GREY);
        right(vatLabel(p.vatRate), P.vat, 9, font, GREY);
        right(euro(p.totalInclCents), P.total, 9, font, GREY);
        y -= 12;
      }
      y -= 6;
    }
    ensure(24);
    y += 2;
    rule();
    y -= 13;
    text(`Subtotal ${rows[0].borrel} — ${shortDay(new Date(rows[0].date))}`, M, 9.5, bold);
    right(euro(rows.reduce((sum, p) => sum + p.totalInclCents, 0)), P.total, 9.5, bold);
    y -= 28;
  }
  if (purchases.length === 0) {
    text("No purchases.", M, 10, font, GREY);
    y -= 24;
  }

  // ── Total, with VAT per category (always VL 9% and VH 21%) ──────────────────
  const summary = vatSummary(b);
  const C = { cat: M + 8, excl: 330, vat: 420, incl: W - 8 };
  const boxRows = summary.length + 2;
  ensure(14 * boxRows + 30);
  text("Total", M, 12, bold);
  y -= 12;
  page.drawRectangle({ x: M, y: y - 14 * boxRows + 2, width: W - M, height: 14 * boxRows + 8, color: SHADE });
  y -= 6;
  text("VAT category", C.cat, 8, bold, GREY);
  right("Excl. VAT", C.excl, 8, bold, GREY);
  right("VAT", C.vat, 8, bold, GREY);
  right("Incl. VAT", C.incl, 8, bold, GREY);
  y -= 15;
  for (const r of summary) {
    text(vatLabel(r.rate), C.cat, 10);
    right(euro(r.exclCents), C.excl, 10);
    right(euro(r.vatCents), C.vat, 10);
    right(euro(r.inclCents), C.incl, 10);
    y -= 14;
  }
  text(`Total (${b.drinks} drinks)`, C.cat, 11, bold);
  right(euro(b.totalExclCents), C.excl, 11, bold);
  right(euro(b.totalVatCents), C.vat, 11, bold);
  right(euro(b.totalInclCents), C.incl, 11, bold);

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const z = 8;
    p.drawText(safe(`Stress · specification ${s.number} · ${label}`), { x: M, y: M - 20, size: z, font, color: GREY });
    const n = `Page ${i + 1} of ${pages.length}`;
    p.drawText(n, { x: W - font.widthOfTextAtSize(n, z), y: M - 20, size: z, font, color: GREY });
  });
  return doc.save();
}

// CSV of every purchase (for the bookkeeping / Dimensie's treasurer). Prices incl.
// VAT; excl. and VAT backed out per row. Semicolon-separated, decimal comma —
// opens in Dutch Excel.
export function settlementCsv(number: string, snap: SettlementSnapshot): string {
  const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [
    ["reference", "date", "borrel", "member", "congressus_id", "drink", "quantity", "unit_incl_vat", "vat_category", "total_excl_vat", "vat", "total_incl_vat"],
  ];
  for (const p of snap.purchases ?? []) {
    const excl = Math.round((p.totalInclCents * 100) / (100 + p.vatRate));
    rows.push([
      number,
      new Date(p.date).toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam" }),
      p.borrel,
      p.member,
      String(p.congressusId ?? ""),
      p.drink,
      String(p.quantity),
      money(p.unitInclCents),
      vatLabel(p.vatRate),
      money(excl),
      money(p.totalInclCents - excl),
      money(p.totalInclCents),
    ]);
  }
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
