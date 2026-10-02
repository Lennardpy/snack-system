// Parse an SBZ price-list PDF's extracted text into rows, and match them to the
// items of the current list. Layout (one product per line, under section headers):
//
//   SBZ price list effective 01/10/2026 (V2)
//   Beer Old New
//   BTW Cost price excl. BTW incl. BTW excl. BTW incl. BTW
//   Grolsch Premium Pilsner liter 21% € 1.78 € 1.82 € 2.20 € 1.65 € 2.00
//   Craft beer of the month bottle 21% varying € 1.24 € 1.50 € 1.16 € 1.40
//
// Columns after the VAT %: SBZ's cost price (ignored, may be "varying"), the OLD
// excl/incl price, the NEW excl/incl price. We take the last four amounts. The
// admin reviews the matched result before anything is saved.

import type { SbzProduct, SbzUnit } from "./sbz";

export interface SbzPdfRow {
  name: string;
  section: string;
  unit: SbzUnit;
  vatRate: number;
  oldExclCents: number | null;
  oldInclCents: number | null;
  costExclCents: number; // new
  costInclCents: number; // new
  matchKey: string | null; // suggested existing item, null = new item
}
export interface SbzPdfParse {
  label: string | null;
  validFrom: string | null; // YYYY-MM-DD from the "effective dd/mm/yyyy" header
  rows: SbzPdfRow[];
}

const ROW_RE = /^(.+)\s+(liter|litre|bottle|can|shot)\s+(\d{1,2})%\s+(.+)$/i;
const AMOUNT_RE = /€\s*(\d+(?:[.,]\d{1,2})?)/g;
const SECTION_RE = /^(.+?)\s+Old\s+New\s*$/i;

const cents = (s: string) => Math.round(Number(s.replace(",", ".")) * 100);

function normalizeSection(raw: string): string {
  const s = raw.replace(/\(.*?\)/g, "").trim().toLowerCase();
  if (s.startsWith("beer")) return "Beer";
  if (s.startsWith("on request")) return "On request";
  if (s.startsWith("soft")) return "Soft drinks";
  return "Other";
}

export function parseSbzPriceList(text: string): SbzPdfParse {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  let label: string | null = null;
  let validFrom: string | null = null;
  let section = "Other";
  const rows: SbzPdfRow[] = [];

  for (const line of lines) {
    const eff = line.match(/effective\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/i);
    if (eff && !validFrom) {
      label = line;
      validFrom = `${eff[3]}-${eff[2].padStart(2, "0")}-${eff[1].padStart(2, "0")}`;
      continue;
    }
    const sec = line.match(SECTION_RE);
    if (sec) {
      section = normalizeSection(sec[1]);
      continue;
    }
    const m = line.match(ROW_RE);
    if (!m) continue;
    const amounts = [...m[4].matchAll(AMOUNT_RE)].map((a) => cents(a[1]));
    if (amounts.length < 2) continue;
    const [newIncl, newExcl] = [amounts[amounts.length - 1], amounts[amounts.length - 2]];
    const hasOld = amounts.length >= 4;
    rows.push({
      name: m[1].trim(),
      section,
      unit: /^lit/i.test(m[2]) ? "LITER" : "UNIT",
      vatRate: Number(m[3]),
      oldExclCents: hasOld ? amounts[amounts.length - 4] : null,
      oldInclCents: hasOld ? amounts[amounts.length - 3] : null,
      costExclCents: newExcl,
      costInclCents: newIncl,
      matchKey: null,
    });
  }
  return { label, validFrom, rows };
}

// ── Matching PDF names to existing items ──────────────────────────────────────
// "Grolsch Premium Pilsner" ↔ "Grolsch Premium Pilsner (keg)",
// "Fuze Tea bottle 1.25L" ↔ "Fuze Tea 1.25 L (bottle)",
// "Soft drinks bottle 0,20/0,25 L" ↔ "Soft drink 0.20/0.25 L (bottle)".
function tokens(name: string): Set<string> {
  const s = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\((keg|bottle|can|shot)\)/g, " ")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)l\b/g, "$1 l")
    .replace(/[()/%]/g, " ");
  const out = new Set<string>();
  for (let t of s.split(/\s+/)) {
    if (!t || t === "keg" || t === "bottle" || t === "can") continue;
    if (t === "liter" || t === "litre") t = "l";
    if (t.length > 3 && t.endsWith("s")) t = t.slice(0, -1); // drinks → drink, shots → shot
    out.add(t);
  }
  return out;
}

function similarity(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

// Suggest an existing item for each row: same unit, word similarity ≥ 0.6, with a
// small bonus when the row's OLD price equals ours. Assigned globally best-score
// first, so each existing item is used at most once regardless of row order.
export function matchSbzRows(rows: SbzPdfRow[], items: SbzProduct[]): SbzPdfRow[] {
  const itemTokens = items.map((i) => ({ item: i, tok: tokens(i.name) }));
  const pairs: { row: number; key: string; score: number }[] = [];
  rows.forEach((row, r) => {
    const rt = tokens(row.name);
    for (const { item, tok } of itemTokens) {
      if (item.unit !== row.unit) continue;
      let score = similarity(rt, tok);
      if (score < 0.6) continue;
      if (row.oldInclCents != null && row.oldInclCents === item.costInclCents) score += 0.05;
      pairs.push({ row: r, key: item.key, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score);
  const byRow = new Map<number, string>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (byRow.has(p.row) || used.has(p.key)) continue;
    byRow.set(p.row, p.key);
    used.add(p.key);
  }
  return rows.map((row, r) => ({ ...row, matchKey: byRow.get(r) ?? null }));
}
