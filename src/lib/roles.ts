// Member-role discounts applied at the PPP bar.
//
// A role can discount a drink by a percentage and/or a fixed number of cents per
// product; the two stack within a role. A member may hold several roles — for each
// product the BEST (largest) discount AMOUNT wins, so a fixed-cents role and a
// percentage role are always compared on the same (cents) footing. Examples:
//   Board       → discountPercent 100            (free)
//   PilsCie     → discountCents 75               (€0.75 off each drink)
//   Bartenders  → discountPercent 25             (25% off)
//
// A role marked `ownDrinkOnly` (PilsCie) discounts just ONE drink per order — the
// member's own — so a round bought for friends is charged at the normal price.
// See priceOrder().

export interface RoleDiscount {
  discountPercent: number;
  discountCents: number;
  ownDrinkOnly?: boolean;
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

// ── Whole-order pricing (own-drink-only roles) ────────────────────────────────

export interface OrderItem {
  productId: string;
  quantity: number;
  product: PricedProduct;
  activitySpecialCents: number | null;
  free?: boolean; // comped (bartender's own free drink) → €0, no role discount
}
export interface PricedOrderPart {
  productId: string;
  quantity: number;
  unitCents: number;
}

// Prices a whole order for a member. Roles with `ownDrinkOnly` discount only ONE
// unit — the member's own drink, chosen as the unit where they save the most
// (ties → first item). Every other unit gets only the member's other roles. An
// item whose own-drink unit differs in price is split into two parts (1 + rest).
export function priceOrder(items: OrderItem[], roles: RoleDiscount[]): PricedOrderPart[] {
  const everyUnit = roles.filter((r) => !r.ownDrinkOnly);
  const hasOwnDrinkRole = everyUnit.length < roles.length;
  const priced = items.map((it) => ({
    it,
    base: it.free ? 0 : activityDiscountedUnitPrice(it.product, it.activitySpecialCents, everyUnit),
    own: it.free ? 0 : activityDiscountedUnitPrice(it.product, it.activitySpecialCents, roles),
  }));

  let ownIdx = -1;
  if (hasOwnDrinkRole) {
    let bestSaving = 0;
    priced.forEach((p, i) => {
      if (p.it.quantity > 0 && p.base - p.own > bestSaving) {
        bestSaving = p.base - p.own;
        ownIdx = i;
      }
    });
  }

  const parts: PricedOrderPart[] = [];
  priced.forEach((p, i) => {
    const { productId, quantity } = p.it;
    if (i === ownIdx) {
      parts.push({ productId, quantity: 1, unitCents: p.own });
      if (quantity > 1) parts.push({ productId, quantity: quantity - 1, unitCents: p.base });
    } else {
      parts.push({ productId, quantity, unitCents: p.base });
    }
  });
  return parts;
}

// Which role granted the discount on a charged line, and how much (per unit) —
// for the per-role cost reports. Capped at the discount actually given, so a
// full-price unit of a round (own-drink-only role not applied) costs nothing, and
// credited to an every-drink role when that alone explains the price.
export function attributeRoleDiscount(
  preRoleCents: number,
  unitCents: number,
  roles: (RoleDiscount & { name: string })[],
  ignoreFixed: boolean
): { role: string; amountCents: number } | null {
  const actual = Math.max(0, preRoleCents - unitCents);
  if (actual === 0 || roles.length === 0) return null;
  const best = (rs: (RoleDiscount & { name: string })[]) =>
    rs.reduce<{ role: string; amt: number }>(
      (b, r) => {
        const amt = roleDiscountAmount(preRoleCents, r, ignoreFixed);
        return amt > b.amt ? { role: r.name, amt } : b;
      },
      { role: "", amt: 0 }
    );
  const everyDrink = best(roles.filter((r) => !r.ownDrinkOnly));
  const pick = everyDrink.amt > 0 && everyDrink.amt >= actual ? everyDrink : best(roles);
  if (!pick.role || pick.amt === 0) return null;
  return { role: pick.role, amountCents: Math.min(pick.amt, actual) };
}

// ── Discount/budget reporting ─────────────────────────────────────────────────
// Sum the discount given across PPP invoice lines, split into:
//   • specialsCents — only the activity drink specials (list → special price)
//   • totalCents    — everything (specials + role/free-drink discounts): list → charged
// Uses the per-line snapshots; falls back to the current product price for old rows.
export interface DiscountLine {
  quantity: number;
  unitCents: number;
  listCents: number | null;
  specialCents: number | null;
  product: { price: number };
}
export function sumLineDiscounts(lines: DiscountLine[]): { specialsCents: number; totalCents: number } {
  let specialsCents = 0;
  let totalCents = 0;
  for (const l of lines) {
    const list = l.listCents ?? l.product.price;
    totalCents += Math.max(0, list - l.unitCents) * l.quantity;
    if (l.specialCents != null) specialsCents += Math.max(0, list - l.specialCents) * l.quantity;
  }
  return { specialsCents, totalCents };
}

// Short human label for a single role's discount, e.g. "free", "-25%",
// "-€0.75", or "-25% + -€0.50". Used on chips across the admin + POS.
export function formatRoleDiscount(role: RoleDiscount): string {
  if (clampPercent(role.discountPercent) >= 100) return "free";
  const parts: string[] = [];
  if (role.discountPercent > 0) parts.push(`-${clampPercent(role.discountPercent)}%`);
  if (role.discountCents > 0) parts.push(`-€${(clampCents(role.discountCents) / 100).toFixed(2)}`);
  const label = parts.join(" + ") || "no discount";
  return role.ownDrinkOnly && parts.length > 0 ? `${label} · own drink` : label;
}
