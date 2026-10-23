import type { ExternalBreakdown } from "./external";

// VAT presentation shared by server (PDF/CSV) and client pages.

// Dutch VAT categories as in Congressus / the bookkeeping: VL = low (9%), VH = high (21%).
export function vatLabel(rate: number): string {
  return rate === 9 ? "VL 9%" : rate === 21 ? "VH 21%" : `${rate}%`;
}

// VAT per category, always with both VL and VH (zero when none) — plus any other rate.
export function vatSummary(b: Pick<ExternalBreakdown, "vatByRate">) {
  const rows = new Map<number, { rate: number; exclCents: number; vatCents: number; inclCents: number }>();
  for (const rate of [9, 21]) rows.set(rate, { rate, exclCents: 0, vatCents: 0, inclCents: 0 });
  for (const r of b.vatByRate) {
    rows.set(r.rate, { rate: r.rate, exclCents: r.baseCents, vatCents: r.vatCents, inclCents: r.baseCents + r.vatCents });
  }
  return [...rows.values()].sort((a, b) => a.rate - b.rate);
}
