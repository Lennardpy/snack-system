// Expiry-based discounting.
//
// A product with a best-before date (`expiresAt`) goes on sale at 50% off once
// it enters its final week — i.e. from 7 days before the date onward — and stays
// discounted after the date passes (until the admin clears/updates it).

export const DISCOUNT_WINDOW_DAYS = 7;
export const DISCOUNT_RATE = 0.5; // 50% off
const WINDOW_MS = DISCOUNT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Whether the expiry discount is currently active for this date. */
export function isOnSale(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return now.getTime() >= expiresAt.getTime() - WINDOW_MS;
}

/** The price actually charged, in cents — discounted when on sale. */
export function effectivePriceCents(
  priceCents: number,
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (!isOnSale(expiresAt, now)) return priceCents;
  return Math.round(priceCents * (1 - DISCOUNT_RATE));
}
