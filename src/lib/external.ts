// External cards — pricing for an external tab (client-safe, no Prisma).
//
// A tab's lines snapshot the INTERNAL selling price per unit (incl. VAT). The
// tab's price level multiplies it; VAT is then backed out of the incl. price per
// line, at the line's own rate. Totals are the sum of the lines, so the PDF's
// lines always add up to its totals.

export type ExternalPriceLevel = "INTERNAL" | "INTERNAL_PLUS_10" | "TUSSEN" | "EXTERNAL";

export const PRICE_LEVELS: { value: ExternalPriceLevel; label: string; factor: number }[] = [
  { value: "INTERNAL", label: "Internal", factor: 1 },
  { value: "INTERNAL_PLUS_10", label: "Internal + 10%", factor: 1.1 },
  { value: "TUSSEN", label: "Tussen (1.5×)", factor: 1.5 },
  { value: "EXTERNAL", label: "External (2×)", factor: 2 },
];

export const isPriceLevel = (v: unknown): v is ExternalPriceLevel =>
  PRICE_LEVELS.some((l) => l.value === v);

export const priceLevelLabel = (v: ExternalPriceLevel) =>
  PRICE_LEVELS.find((l) => l.value === v)?.label ?? v;

export const VAT_RATE: Record<"ZERO" | "LOW" | "STANDARD", number> = { ZERO: 0, LOW: 9, STANDARD: 21 };

export interface ExternalLineIn {
  productId: string;
  name: string;
  quantity: number;
  unitCents: number; // internal price incl. VAT
  vatRate: number;
}
export interface ExternalLineOut {
  productId: string;
  name: string;
  quantity: number;
  vatRate: number;
  unitInclCents: number;
  unitExclCents: number;
  totalInclCents: number;
  totalExclCents: number;
}
export interface ExternalBreakdown {
  lines: ExternalLineOut[];
  totalExclCents: number;
  totalVatCents: number;
  totalInclCents: number;
  vatByRate: { rate: number; baseCents: number; vatCents: number }[];
  drinks: number;
}

const excl = (inclCents: number, rate: number) => Math.round((inclCents * 100) / (100 + rate));

// Merge a tab's lines per drink + internal price + VAT rate, and price them at the level.
export function externalBreakdown(lines: ExternalLineIn[], level: ExternalPriceLevel): ExternalBreakdown {
  const factor = PRICE_LEVELS.find((l) => l.value === level)?.factor ?? 1;
  const merged = new Map<string, ExternalLineIn>();
  for (const l of lines) {
    const key = `${l.productId}-${l.unitCents}-${l.vatRate}`;
    const e = merged.get(key);
    if (e) e.quantity += l.quantity;
    else merged.set(key, { ...l });
  }

  const out: ExternalLineOut[] = [...merged.values()]
    .filter((l) => l.quantity > 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.unitCents - b.unitCents)
    .map((l) => {
      const unitInclCents = Math.round(l.unitCents * factor);
      const totalInclCents = unitInclCents * l.quantity;
      return {
        productId: l.productId,
        name: l.name,
        quantity: l.quantity,
        vatRate: l.vatRate,
        unitInclCents,
        unitExclCents: excl(unitInclCents, l.vatRate),
        totalInclCents,
        totalExclCents: excl(totalInclCents, l.vatRate),
      };
    });

  const byRate = new Map<number, { rate: number; baseCents: number; vatCents: number }>();
  for (const l of out) {
    const r = byRate.get(l.vatRate) ?? { rate: l.vatRate, baseCents: 0, vatCents: 0 };
    r.baseCents += l.totalExclCents;
    r.vatCents += l.totalInclCents - l.totalExclCents;
    byRate.set(l.vatRate, r);
  }
  const totalInclCents = out.reduce((s, l) => s + l.totalInclCents, 0);
  const totalExclCents = out.reduce((s, l) => s + l.totalExclCents, 0);
  return {
    lines: out,
    totalExclCents,
    totalVatCents: totalInclCents - totalExclCents,
    totalInclCents,
    vatByRate: [...byRate.values()].sort((a, b) => a.rate - b.rate),
    drinks: out.reduce((s, l) => s + l.quantity, 0),
  };
}

// An external card's spending limit from admin input (euros, e.g. 100 or "100,50")
// → cents; null for no limit (empty); undefined when invalid.
export function parseLimit(v: unknown): number | null | undefined {
  if (v === null || v === "" || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 100_000) return undefined;
  return Math.round(n * 100);
}
