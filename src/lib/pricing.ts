// Expiry-based discounting.
//
// A product with a best-before date (`expiresAt`) is discounted as it ages:
//   • final 7 days (up to and including the best-before date) → 50% off
//   • once the best-before date has passed                    → free
//
// The best-before date is treated as INCLUSIVE: the product is still "good"
// through the end of that calendar day, and becomes free the day after.

export const DISCOUNT_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = DISCOUNT_WINDOW_DAYS * DAY_MS;

export type DiscountStage = "FREE" | "HALF" | null;

// End of the best-before day (the product is good until this instant).
function goodUntil(expiresAt: Date): number {
  return expiresAt.getTime() + DAY_MS;
}

/** Which discount tier (if any) is currently active. */
export function discountStage(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): DiscountStage {
  if (!expiresAt) return null;
  const t = now.getTime();
  const end = goodUntil(expiresAt);
  if (t >= end) return "FREE"; // past the best-before date
  if (t >= end - WINDOW_MS) return "HALF"; // final 7 days
  return null;
}

/** Whether any expiry discount is currently active. */
export function isOnSale(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  return discountStage(expiresAt, now) !== null;
}

/** The price actually charged, in cents — half during the final week, free after. */
export function effectivePriceCents(
  priceCents: number,
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): number {
  switch (discountStage(expiresAt, now)) {
    case "FREE":
      return 0;
    case "HALF":
      return Math.round(priceCents * 0.5);
    default:
      return priceCents;
  }
}
