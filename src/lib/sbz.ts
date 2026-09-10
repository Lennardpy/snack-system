// SBZ price list (what the association is invoiced for drinks) — the cost side of
// a borrel's profit/loss. Fixed reference data from the SBZ price list (April 2026);
// update here when SBZ revises prices, then redeploy.
//
// Two cost columns are stored per item: `costExclCents` (net) and `costInclCents`
// (gross, what SBZ actually invoices). The P/L headlines on the gross (incl. BTW)
// figure; net is kept for VAT-settled reporting.
//
// Usage is entered against these items in the activity P/L:
//   • unit "LITER"  → kegs, entered in KG on the usage form. Beer density ≈ 1 kg/L,
//     so cost = kg × cost-per-liter (a documented ~1–3% approximation).
//   • unit "UNIT"   → bottles / cans / shots, entered as a count.

export type SbzUnit = "LITER" | "UNIT";
export type SbzSection = "Beer" | "On request" | "Soft drinks" | "Other";

export interface SbzProduct {
  key: string; // stable slug used to store usage against
  name: string;
  section: SbzSection;
  unit: SbzUnit; // LITER = keg (kg on the form), UNIT = bottle/can/shot
  vatRate: number; // 21 or 9
  costExclCents: number; // net, per liter (kegs) or per unit
  costInclCents: number; // gross (invoiced), per liter (kegs) or per unit
  onRequest?: boolean; // "on request / with reservation" items
}

export const SBZ_PRODUCTS: SbzProduct[] = [
  // ── Beer ──────────────────────────────────────────────────────────────────
  { key: "premium-pilsner", name: "Grolsch Premium Pilsner (keg)", section: "Beer", unit: "LITER", vatRate: 21, costExclCents: 182, costInclCents: 220 },
  { key: "weizen-keg", name: "Grolsch Weizen (keg)", section: "Beer", unit: "LITER", vatRate: 21, costExclCents: 410, costInclCents: 496 },
  { key: "herfstbok-keg", name: "Grolsch Herfstbok (keg)", section: "Beer", unit: "LITER", vatRate: 21, costExclCents: 460, costInclCents: 557 },
  { key: "lentebok-keg", name: "Grolsch Lentebok (keg)", section: "Beer", unit: "LITER", vatRate: 21, costExclCents: 460, costInclCents: 557 },
  { key: "zomerzon-keg", name: "Grolsch Zomerzon (keg)", section: "Beer", unit: "LITER", vatRate: 21, costExclCents: 460, costInclCents: 557 },
  { key: "rose-keg", name: "Grolsch Rosé (keg)", section: "Beer", unit: "LITER", vatRate: 21, costExclCents: 410, costInclCents: 496 },
  { key: "radler-20", name: "Grolsch Radler 2.0% (bottle)", section: "Beer", unit: "UNIT", vatRate: 21, costExclCents: 70, costInclCents: 85 },
  { key: "radler-00", name: "Grolsch Radler 0.0% (bottle)", section: "Beer", unit: "UNIT", vatRate: 9, costExclCents: 78, costInclCents: 85 },
  { key: "grolsch-00", name: "Grolsch 0.0% (bottle)", section: "Beer", unit: "UNIT", vatRate: 9, costExclCents: 78, costInclCents: 85 },
  { key: "weizen-00", name: "Grolsch Weizen 0.0% (bottle)", section: "Beer", unit: "UNIT", vatRate: 9, costExclCents: 92, costInclCents: 100 },
  { key: "zomertijd-00", name: "Grolsch Zomertijd 0.0% (bottle)", section: "Beer", unit: "UNIT", vatRate: 9, costExclCents: 92, costInclCents: 100 },
  { key: "craft-beer", name: "Craft beer of the month (bottle)", section: "Beer", unit: "UNIT", vatRate: 21, costExclCents: 124, costInclCents: 150 },

  // ── On request (kegs) ───────────────────────────────────────────────────────
  { key: "grimbergen-dubbel", name: "Grimbergen Dubbel (keg)", section: "On request", unit: "LITER", vatRate: 21, costExclCents: 460, costInclCents: 557, onRequest: true },
  { key: "grimbergen-blanche", name: "Grimbergen Blanche (keg)", section: "On request", unit: "LITER", vatRate: 21, costExclCents: 460, costInclCents: 557, onRequest: true },
  { key: "grimbergen-blond", name: "Grimbergen Blond (keg)", section: "On request", unit: "LITER", vatRate: 21, costExclCents: 460, costInclCents: 557, onRequest: true },
  { key: "grimbergen-tripel", name: "Grimbergen Tripel (keg)", section: "On request", unit: "LITER", vatRate: 21, costExclCents: 460, costInclCents: 557, onRequest: true },

  // ── Soft drinks ─────────────────────────────────────────────────────────────
  { key: "cola-fanta-125", name: "Cola/Fanta 1.5/1.25 L (bottle)", section: "Soft drinks", unit: "UNIT", vatRate: 9, costExclCents: 225, costInclCents: 245 },
  { key: "fuze-tea-125", name: "Fuze Tea 1.25 L (bottle)", section: "Soft drinks", unit: "UNIT", vatRate: 9, costExclCents: 245, costInclCents: 267 },
  { key: "soft-drink-small", name: "Soft drink 0.20/0.25 L (bottle)", section: "Soft drinks", unit: "UNIT", vatRate: 9, costExclCents: 70, costInclCents: 76 },

  // ── Other (with reservation) ─────────────────────────────────────────────────
  { key: "apple-bandit", name: "Apple Bandit (bottle)", section: "Other", unit: "UNIT", vatRate: 21, costExclCents: 129, costInclCents: 156 },
  { key: "viper", name: "Viper (can)", section: "Other", unit: "UNIT", vatRate: 21, costExclCents: 129, costInclCents: 156 },
  { key: "wine-075", name: "Wine 0.75 L (bottle)", section: "Other", unit: "UNIT", vatRate: 21, costExclCents: 490, costInclCents: 593 },
  { key: "flugel-shots", name: "Flügel shots (bottle)", section: "Other", unit: "UNIT", vatRate: 21, costExclCents: 70, costInclCents: 85 },
  { key: "nozem-shots", name: "Nozem shots (shot)", section: "Other", unit: "UNIT", vatRate: 21, costExclCents: 58, costInclCents: 70 },
  { key: "shots", name: "Shots (shot)", section: "Other", unit: "UNIT", vatRate: 21, costExclCents: 75, costInclCents: 91 },
];

export const SBZ_BY_KEY: Record<string, SbzProduct> = Object.fromEntries(
  SBZ_PRODUCTS.map((p) => [p.key, p])
);

// Cost (gross, incl. BTW) of a used quantity of an SBZ item. For kegs the quantity
// is kg (≈ liters); for units it's the count.
export function sbzCostInclCents(key: string, quantity: number): number {
  const p = SBZ_BY_KEY[key];
  if (!p || !Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.round(p.costInclCents * quantity);
}

export function sbzCostExclCents(key: string, quantity: number): number {
  const p = SBZ_BY_KEY[key];
  if (!p || !Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.round(p.costExclCents * quantity);
}
