// Parse an Alexia "Verbruiksformulier" (usage form) PDF's extracted text and map
// its lines to SBZ price-list items, to pre-fill the activity usage form.
//
// The form has two parts:
//   • "Verbruik"  — unit items: "<name> <count>" (name may wrap onto two lines).
//   • "Fustbier"  — kegs, a table per keg ending in value columns
//     (Begin, Einde, # Fusten, Flow start, Flow eind, Totaal Gewicht, Flow);
//     the consumed kg is the "Totaal Gewicht" column (2nd-to-last value).
//
// Alexia uses its own product names, so matching to SBZ keys is best-effort +
// unit-aware (kegs → LITER items). Unmatched lines are returned for the admin to
// map by hand. Nothing here is authoritative — the admin reviews before saving.

import { SBZ_PRODUCTS } from "./sbz";

export interface ParsedUsageLine {
  name: string;
  quantity: number; // count for units, kg for kegs
  isKeg: boolean;
}
export interface MatchedUsage {
  matched: { sbzKey: string; quantity: number; name: string }[];
  unmatched: ParsedUsageLine[];
}

// ── Name matching ─────────────────────────────────────────────────────────────
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (ü → u)
    .replace(/[()/,%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Per SBZ key: groups of required tokens (any group matches), optional excludes.
const RULES: Record<string, { groups: string[][]; not?: string[] }> = {
  "premium-pilsner": { groups: [["premium", "pils"], ["premium", "pilsner"]] },
  "weizen-keg": { groups: [["weizen"]], not: ["0.0", "0 0"] },
  "herfstbok-keg": { groups: [["herfstbok"]] },
  "lentebok-keg": { groups: [["lentebok"]] },
  "zomerzon-keg": { groups: [["zomerzon"], ["sunny"]] },
  "rose-keg": { groups: [["rose"]] },
  "grimbergen-dubbel": { groups: [["grimbergen", "dubbel"]] },
  "grimbergen-blanche": { groups: [["grimbergen", "blanche"]] },
  "grimbergen-blond": { groups: [["grimbergen", "blond"]] },
  "grimbergen-tripel": { groups: [["grimbergen", "tripel"]] },
  "radler-20": { groups: [["radler", "2.0"], ["radler", "2 0"]] },
  "radler-00": { groups: [["radler", "0.0"], ["radler", "0 0"]] },
  "weizen-00": { groups: [["weizen", "0.0"], ["weizen", "0 0"]] },
  "zomertijd-00": { groups: [["zomertijd"]] },
  "grolsch-00": { groups: [["grolsch", "0.0"], ["grolsch", "0 0"]], not: ["radler", "weizen", "zomertijd", "zomerzon"] },
  "craft-beer": { groups: [["craft"]] },
  "cola-fanta-125": { groups: [["cola"], ["fanta"], ["coca"]] },
  "fuze-tea-125": { groups: [["fuze"]] },
  "soft-drink-small": { groups: [["soda", "0 2"], ["soda", "0 25"], ["soft drink"], ["frisdrank"]] },
  "apple-bandit": { groups: [["apple"], ["bandit"]] },
  "viper": { groups: [["viper"]] },
  "wine-075": { groups: [["wine"], ["wijn"], ["bubbles"]] },
  "flugel-shots": { groups: [["flugel"]] },
  "nozem-shots": { groups: [["nozem"]] },
  "shots": { groups: [["shots"]], not: ["flugel", "nozem"] },
};

// Best SBZ key for an Alexia product name, or null if no confident match.
// `isKeg` restricts to the matching unit (kegs are LITER items).
export function matchSbz(name: string, isKeg: boolean): string | null {
  const hay = norm(name);
  const wantUnit = isKeg ? "LITER" : "UNIT";
  let best: { key: string; score: number } | null = null;
  for (const p of SBZ_PRODUCTS) {
    if (p.unit !== wantUnit) continue;
    const rule = RULES[p.key];
    if (!rule) continue;
    if (rule.not?.some((t) => hay.includes(t))) continue;
    let score = 0;
    for (const g of rule.groups) if (g.every((t) => hay.includes(t))) score = Math.max(score, g.length);
    if (score > 0 && (!best || score > best.score)) best = { key: p.key, score };
  }
  return best?.key ?? null;
}

// ── Parsing ───────────────────────────────────────────────────────────────────
const VALUE_RE = /^(—|–|-|\d{1,5}(?:[.,]\d+)?)$/; // a keg table cell: number or dash
const parseNum = (s: string): number => {
  const n = Number(s.replace(/\./g, "").replace(",", ".")); // 1.234,5 → 1234.5; 41,7 → 41.7
  return Number.isFinite(n) ? n : NaN;
};

// Parse the Verbruik (units) + Fustbier (kegs) lines into usage lines.
export function parseVerbruik(text: string): ParsedUsageLine[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const idxVerbruik = lines.findIndex((l) => /^verbruik$/i.test(l));
  const idxFust = lines.findIndex((l) => /^fustbier\b/i.test(l));
  const idxEnd = lines.findIndex((l) => /^commentaar\b/i.test(l));

  const out: ParsedUsageLine[] = [];

  // Verbruik (units): "<name...> <count>", name may span the previous line(s).
  if (idxVerbruik >= 0) {
    const stop = idxFust >= 0 ? idxFust : idxEnd >= 0 ? idxEnd : lines.length;
    let buf: string[] = [];
    for (let i = idxVerbruik + 1; i < stop; i++) {
      const line = lines[i];
      const m = line.match(/^(.*?)\s+(\d+)$/);
      if (m) {
        const name = [...buf, m[1]].join(" ").trim();
        if (name) out.push({ name, quantity: Number(m[2]), isKeg: false });
        buf = [];
      } else {
        buf.push(line);
      }
    }
  }

  // Fustbier (kegs): each keg is "<name...> <val> <val> … <Totaal Gewicht> <Flow>".
  if (idxFust >= 0) {
    const stop = idxEnd >= 0 ? idxEnd : lines.length;
    // Skip the multi-line column header; keg rows start after the "Gewicht" header.
    let start = idxFust + 1;
    for (let i = idxFust; i < stop; i++) {
      if (/gewicht/i.test(lines[i])) {
        start = i + 1;
        break;
      }
    }
    let buf: string[] = [];
    for (let i = start; i < stop; i++) {
      const tokens = lines[i].split(/\s+/);
      // Trailing run of value cells (numbers / dashes).
      let k = tokens.length;
      while (k > 0 && VALUE_RE.test(tokens[k - 1])) k--;
      const values = tokens.slice(k);
      if (values.length >= 3) {
        const namePrefix = tokens.slice(0, k).join(" ");
        const name = [...buf, namePrefix].join(" ").trim();
        // Totaal Gewicht is the 2nd-to-last cell; fall back to the last (Flow).
        let kg = parseNum(values[values.length - 2]);
        if (!Number.isFinite(kg)) kg = parseNum(values[values.length - 1]);
        if (name && Number.isFinite(kg) && kg > 0) out.push({ name, quantity: kg, isKeg: true });
        buf = [];
      } else {
        buf.push(lines[i]);
      }
    }
  }

  return out;
}

// Parse + match in one go.
export function extractUsage(text: string): MatchedUsage {
  const lines = parseVerbruik(text);
  const matched: MatchedUsage["matched"] = [];
  const unmatched: ParsedUsageLine[] = [];
  for (const l of lines) {
    const key = matchSbz(l.name, l.isKeg);
    if (key) matched.push({ sbzKey: key, quantity: l.quantity, name: l.name });
    else unmatched.push(l);
  }
  return { matched, unmatched };
}
