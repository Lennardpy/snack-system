// SumUp card revenue for a borrel's P/L. Reads successful card transactions in a
// time window from the SumUp transactions API (the bar's card terminal).
//
// Auth: a SumUp secret API key in SUMUP_API_KEY (used as a Bearer token). The key
// identifies the merchant, so no merchant id is needed. Everything fails soft —
// a missing key or any error yields `null` so the P/L still renders.

const BASE = "https://api.sumup.com";

interface SumupTx {
  amount: number; // decimal, merchant currency (EUR)
  currency: string;
  status: string; // SUCCESSFUL | FAILED | ...
  type: string; // PAYMENT | REFUND | ...
  refunded_amount?: number;
  timestamp: string;
}

export interface SumupWindowResult {
  revenueCents: number; // net card revenue (payments − refunds) in the window
  count: number; // successful payments counted
}

// Sum successful card payments (minus refunds) between two ISO timestamps.
// Returns null when SumUp is unavailable (no key / error) so callers can degrade.
export async function fetchSumupRevenue(
  fromISO: string,
  toISO: string
): Promise<SumupWindowResult | null> {
  const key = process.env.SUMUP_API_KEY;
  if (!key) return null;

  const headers = { Authorization: `Bearer ${key}` };
  let url =
    `${BASE}/v0.1/me/transactions/history?order=ascending&limit=200` +
    `&oldest_time=${encodeURIComponent(fromISO)}&newest_time=${encodeURIComponent(toISO)}`;

  let revenueCents = 0;
  let count = 0;

  try {
    for (let page = 0; page < 25; page++) {
      // hard page cap
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { items?: SumupTx[]; links?: { href: string; rel: string }[] };
      for (const tx of body.items ?? []) {
        if (tx.status !== "SUCCESSFUL") continue;
        const amt = Math.round((tx.amount ?? 0) * 100);
        if (tx.type === "REFUND") {
          revenueCents -= Math.abs(amt);
        } else {
          revenueCents += amt - Math.round((tx.refunded_amount ?? 0) * 100);
          count++;
        }
      }
      const next = (body.links ?? []).find((l) => l.rel === "next")?.href;
      if (!next) break;
      // The API returns the next link as a bare query string.
      url = next.startsWith("http")
        ? next
        : next.startsWith("/")
        ? `${BASE}${next}`
        : `${BASE}/v0.1/me/transactions/history?${next}`;
    }
    return { revenueCents, count };
  } catch {
    return null;
  }
}
