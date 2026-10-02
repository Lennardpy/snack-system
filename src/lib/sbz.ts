// SBZ price list (what the association is invoiced for drinks) — the cost side of
// a borrel's profit/loss. Client-safe types + cost helpers; the versioned lists
// live in the database (SbzPriceList / SbzPrice, loaded via src/lib/sbz-db.ts) and
// are managed on the admin "SBZ prices" page.
//
// Versioned: each list is valid from its `validFrom` date until the next one, and a
// borrel's cost of goods uses the list valid on the borrel's date — so a new price
// list never changes the cost of earlier borrels.
//
// Two cost columns per item: `costExclCents` (net) and `costInclCents` (gross, what
// SBZ actually invoices). The P/L headlines on the gross (incl. BTW) figure.
//
// Usage is entered against these items in the activity P/L:
//   • unit "LITER"  → kegs, entered in KG on the usage form. Beer density ≈ 1 kg/L,
//     so cost = kg × cost-per-liter (a documented ~1–3% approximation).
//   • unit "UNIT"   → bottles / cans / shots, entered as a count.

export type SbzUnit = "LITER" | "UNIT";
export const SBZ_SECTIONS = ["Beer", "On request", "Soft drinks", "Other"] as const;

export interface SbzProduct {
  key: string; // stable slug usage is stored against (same across versions)
  name: string;
  section: string; // one of SBZ_SECTIONS (free text tolerated)
  unit: SbzUnit; // LITER = keg (kg on the form), UNIT = bottle/can/shot
  vatRate: number; // 21 or 9
  costExclCents: number; // net, per liter (kegs) or per unit
  costInclCents: number; // gross (invoiced), per liter (kegs) or per unit
  onRequest?: boolean; // "on request / with reservation" items
}

// A price list as sent to the client (validFrom as an ISO string).
export interface SbzPriceListInfo {
  id: string;
  label: string;
  validFrom: string;
  source: string | null;
  items: SbzProduct[];
}

export type SbzCatalog = Record<string, SbzProduct>;

export function sbzCatalog(items: SbzProduct[]): SbzCatalog {
  return Object.fromEntries(items.map((p) => [p.key, p]));
}

// Cost (gross, incl. BTW) of a used quantity of an SBZ item. For kegs the quantity
// is kg (≈ liters); for units it's the count. Unknown key → 0.
export function sbzCostInclCents(catalog: SbzCatalog, key: string, quantity: number): number {
  const p = catalog[key];
  if (!p || !Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.round(p.costInclCents * quantity);
}

export function sbzCostExclCents(catalog: SbzCatalog, key: string, quantity: number): number {
  const p = catalog[key];
  if (!p || !Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.round(p.costExclCents * quantity);
}

// URL-safe key for a new item, unique within `taken`.
export function sbzKeyFor(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item";
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
  return key;
}
