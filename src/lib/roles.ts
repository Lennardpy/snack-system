// Member-role discounts applied at the PPP bar.
//
// A role can discount a drink by a percentage and/or a fixed number of cents per
// product; the two stack within a role. A member may hold several roles — for each
// product the BEST (largest) discount AMOUNT wins, so a fixed-cents role and a
// percentage role are always compared on the same (cents) footing. Examples:
//   Board       → discountPercent 100            (free)
//   PilsCie     → discountCents 75               (€0.75 off each drink)
//   Bartenders  → discountPercent 25             (25% off)

export interface RoleDiscount {
  discountPercent: number;
  discountCents: number;
}

export function clampPercent(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, Math.round(p)));
}

export function clampCents(c: number): number {
  if (!Number.isFinite(c)) return 0;
  return Math.max(0, Math.round(c));
}

// Discount amount (in cents) a single role grants on one unit at `priceCents`.
// Percentage and fixed parts stack, capped at the price (never negative).
// `ignoreFixed` drops the fixed-cent part (used for products on a special price).
export function roleDiscountAmount(
  priceCents: number,
  role: RoleDiscount,
  ignoreFixed = false
): number {
  const fromPct = Math.round((priceCents * clampPercent(role.discountPercent)) / 100);
  const fromCents = ignoreFixed ? 0 : clampCents(role.discountCents);
  return Math.min(fromPct + fromCents, priceCents);
}

// Best (largest) discount amount across a member's roles for one unit.
export function bestDiscountAmount(
  priceCents: number,
  roles: RoleDiscount[],
  ignoreFixed = false
): number {
  return roles.reduce((max, r) => Math.max(max, roleDiscountAmount(priceCents, r, ignoreFixed)), 0);
}

// Final unit price after the member's best applicable role discount.
export function discountedUnitPrice(
  priceCents: number,
  roles: RoleDiscount[],
  ignoreFixed = false
): number {
  return Math.max(0, priceCents - bestDiscountAmount(priceCents, roles, ignoreFixed));
}

// ── Product-aware pricing ─────────────────────────────────────────────────────

export interface PricedProduct {
  price: number;
  specialPrice: number | null;
}

// What a member pays per unit BEFORE role discounts: the special price if set.
export function productUnitPrice(p: PricedProduct): number {
  return p.specialPrice ?? p.price;
}

// Final per-unit price for a member: special price (if any) with role discounts.
// On a special-priced product only PERCENTAGE discounts apply (fixed cents skipped).
export function productDiscountedUnitPrice(p: PricedProduct, roles: RoleDiscount[]): number {
  return discountedUnitPrice(productUnitPrice(p), roles, p.specialPrice != null);
}

// Activity-aware pricing. An activity drink special (when active) overrides the
// product's price/specialPrice. Any special — activity OR product — counts as a
// "special", so only percentage role discounts apply (fixed cents skipped).
//   activitySpecialCents: the activity's special price for this product, or null
//   (also pass null when the activity's discounts are toggled off).
export function activityUnitPrice(p: PricedProduct, activitySpecialCents: number | null): number {
  return activitySpecialCents ?? p.specialPrice ?? p.price;
}
export function activityIsSpecial(p: PricedProduct, activitySpecialCents: number | null): boolean {
  return activitySpecialCents != null || p.specialPrice != null;
}
export function activityDiscountedUnitPrice(
  p: PricedProduct,
  activitySpecialCents: number | null,
  roles: RoleDiscount[]
): number {
  return discountedUnitPrice(
    activityUnitPrice(p, activitySpecialCents),
    roles,
    activityIsSpecial(p, activitySpecialCents)
  );
}

// Short human label for a single role's discount, e.g. "free", "-25%",
// "-€0.75", or "-25% + -€0.50". Used on chips across the admin + POS.
export function formatRoleDiscount(role: RoleDiscount): string {
  if (clampPercent(role.discountPercent) >= 100) return "free";
  const parts: string[] = [];
  if (role.discountPercent > 0) parts.push(`-${clampPercent(role.discountPercent)}%`);
  if (role.discountCents > 0) parts.push(`-€${(clampCents(role.discountCents) / 100).toFixed(2)}`);
  return parts.join(" + ") || "no discount";
}
