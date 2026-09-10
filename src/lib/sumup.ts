// SumUp card revenue for a borrel's P/L, broken down per drink. SumUp records the
// product (drink) on each transaction, so we can attribute card sales per drink and
// sum an evening together — not just a lump total.
//
// Auth: a SumUp secret API key in SUMUP_API_KEY (Bearer token) identifying the
// merchant. Everything fails soft — a missing key or any error yields `null` so
// the P/L still renders.
//
// The transaction list doesn't include line items, so we fetch each transaction's
// detail (which has `products`) — bounded by a transaction cap + limited concurrency.

const BASE = "https://api.sumup.com";
const MAX_TX = 600; // safety cap on transactions per window
const CONCURRENCY = 8;

interface SumupHistItem {
  id: string;
  status: string;
  type: string; // PAYMENT | REFUND
}
interface SumupProduct {
  name?: string;
  price?: number;
  quantity?: number;
  total_price?: number;
}
interface SumupDetail {
  type: string;
  amount?: number;
  products?: SumupProduct[];
}

export interface SumupDrink {
  name: string;
  quantity: number;
  revenueCents: number;
}
export interface SumupBreakdown {
  revenueCents: number; // net card revenue in the window
  count: number; // successful card payments
  byDrink: SumupDrink[]; // per-drink, biggest revenue first
}

// Lightweight total of successful card revenue (minus refunds) in a window, from
// the history list alone (no per-transaction detail fetches) — for the dashboard
// aggregate P/L. Returns cents, or null when SumUp is unavailable.
export async function fetchSumupRevenueTotal(fromISO: string, toISO: string): Promise<number | null> {
  const key = process.env.SUMUP_API_KEY;
  if (!key) return null;
  const headers = { Authorization: `Bearer ${key}` };
  let url =
    `${BASE}/v0.1/me/transactions/history?order=ascending&limit=200` +
    `&oldest_time=${encodeURIComponent(fromISO)}&newest_time=${encodeURIComponent(toISO)}`;
  let cents = 0;
  try {
    for (let page = 0; page < 60; page++) {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        items?: { amount?: number; refunded_amount?: number; status: string; type: string }[];
        links?: { href: string; rel: string }[];
      };
      for (const t of body.items ?? []) {
        if (t.status !== "SUCCESSFUL") continue;
        if (t.type === "REFUND") cents -= Math.abs(Math.round((t.amount ?? 0) * 100));
        else cents += Math.round((t.amount ?? 0) * 100) - Math.round((t.refunded_amount ?? 0) * 100);
      }
      const next = (body.links ?? []).find((l) => l.rel === "next")?.href;
      if (!next) break;
      url = next.startsWith("http")
        ? next
        : next.startsWith("/")
        ? `${BASE}${next}`
        : `${BASE}/v0.1/me/transactions/history?${next}`;
    }
    return cents;
  } catch {
    return null;
  }
}

// Sum successful card sales (minus refunds) between two ISO timestamps, per drink.
// Returns null when SumUp is unavailable (no key / error).
export async function fetchSumupBreakdown(
  fromISO: string,
  toISO: string
): Promise<SumupBreakdown | null> {
  const key = process.env.SUMUP_API_KEY;
  if (!key) return null;
  const headers = { Authorization: `Bearer ${key}` };

  try {
    // 1. Collect the window's successful transactions (ids only).
    const txs: SumupHistItem[] = [];
    let url =
      `${BASE}/v0.1/me/transactions/history?order=ascending&limit=200` +
      `&oldest_time=${encodeURIComponent(fromISO)}&newest_time=${encodeURIComponent(toISO)}`;
    for (let page = 0; page < 25 && txs.length < MAX_TX; page++) {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { items?: SumupHistItem[]; links?: { href: string; rel: string }[] };
      for (const it of body.items ?? []) {
        if (it.status === "SUCCESSFUL") txs.push(it);
      }
      const next = (body.links ?? []).find((l) => l.rel === "next")?.href;
      if (!next) break;
      url = next.startsWith("http")
        ? next
        : next.startsWith("/")
        ? `${BASE}${next}`
        : `${BASE}/v0.1/me/transactions/history?${next}`;
    }

    // 2. Fetch each transaction's detail (has line items) with limited concurrency.
    const byName = new Map<string, { quantity: number; revenueCents: number }>();
    let revenueCents = 0;
    let count = 0;

    for (let i = 0; i < txs.length; i += CONCURRENCY) {
      const batch = txs.slice(i, i + CONCURRENCY);
      const details = await Promise.all(
        batch.map((t) =>
          fetch(`${BASE}/v0.1/me/transactions?id=${encodeURIComponent(t.id)}`, {
            headers,
            signal: AbortSignal.timeout(8000),
          })
            .then((r) => (r.ok ? (r.json() as Promise<SumupDetail>) : null))
            .catch(() => null)
        )
      );
      for (const d of details) {
        if (!d) continue;
        const sign = d.type === "REFUND" ? -1 : 1;
        if (sign > 0) count++;
        const products = d.products ?? [];
        if (products.length > 0) {
          for (const p of products) {
            const name = (p.name ?? "").trim() || "Unlabelled";
            const cents =
              Math.round((p.total_price ?? (p.price ?? 0) * (p.quantity ?? 0)) * 100) * sign;
            const qty = (p.quantity ?? 0) * sign;
            const e = byName.get(name) ?? { quantity: 0, revenueCents: 0 };
            e.quantity += qty;
            e.revenueCents += cents;
            byName.set(name, e);
            revenueCents += cents;
          }
        } else {
          // No line items on this transaction — count the amount as unlabelled card.
          const cents = Math.round((d.amount ?? 0) * 100) * sign;
          const e = byName.get("Card (unlabelled)") ?? { quantity: 0, revenueCents: 0 };
          e.revenueCents += cents;
          byName.set("Card (unlabelled)", e);
          revenueCents += cents;
        }
      }
    }

    const byDrink = [...byName.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenueCents - a.revenueCents);

    return { revenueCents, count, byDrink };
  } catch {
    return null;
  }
}
