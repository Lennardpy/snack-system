import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";

// Wall Street mode — drink prices that move with demand.
//
// Every TICK_MS the selected drinks get a new price, as a multiplier `m` of their
// normal price (special price if set, else price). Per tick:
//   1. demand pressure — each drink's share of the drinks sold since the last tick
//      vs. an equal share (1/n). Sums to zero: when one drink rises, the others fall.
//      Scaled by how busy it was (full effect from FULL_DEMAND drinks per tick).
//   2. noise — random, per the volatility level; the mean is removed so it's
//      zero-sum too.
//   3. mean reversion — a pull back towards the normal price.
//   4. clamp to [floor, ceiling] (% of the normal price) and round to €0.05.
// A "market crash" (admin button) puts every drink at the floor until it ends;
// prices then climb back through mean reversion.
//
// Ticks are computed lazily by whoever asks first (the public page, the POS or
// an order) and stored with a unique (activity, index), so concurrent requests
// never compute the same tick twice. The server charges the stored tick prices.

export const TICK_MS = 20_000;
export const CRASH_MS = 60_000;
const FULL_DEMAND = 5;
const REVERSION = 0.04;
// A POS may charge the prices of the tick it showed, if that tick is this recent.
const PRICE_GRACE_MS = 45_000;
const HISTORY_MS = 60 * 60_000;

export type Volatility = "LOW" | "MEDIUM" | "HIGH";
const PARAMS: Record<Volatility, { k: number; sigma: number }> = {
  LOW: { k: 0.15, sigma: 0.015 },
  MEDIUM: { k: 0.25, sigma: 0.025 },
  HIGH: { k: 0.35, sigma: 0.045 },
};
export const isVolatility = (v: unknown): v is Volatility => v === "LOW" || v === "MEDIUM" || v === "HIGH";

type TickPrices = Record<string, { m: number; c: number }>;

const gaussian = () => {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export const wsPriceCents = (baseCents: number, m: number) => Math.max(5, Math.round((baseCents * m) / 5) * 5);

// One step of the price model (pure; exported for testing).
export function nextMultipliers(
  prev: Record<string, number>,
  demand: Record<string, number>,
  volatility: Volatility,
  minM: number,
  maxM: number
): Record<string, number> {
  const ids = Object.keys(prev);
  const n = ids.length;
  if (n === 0) return {};
  const { k, sigma } = PARAMS[volatility];
  const total = ids.reduce((s, id) => s + (demand[id] ?? 0), 0);
  const intensity = Math.min(1, total / FULL_DEMAND);

  const delta: Record<string, number> = {};
  for (const id of ids) {
    const share = total > 0 ? (demand[id] ?? 0) / total : 1 / n;
    delta[id] = k * (share - 1 / n) * intensity + sigma * gaussian();
  }
  const mean = ids.reduce((s, id) => s + delta[id], 0) / n;

  const next: Record<string, number> = {};
  for (const id of ids) {
    const m = prev[id] + (delta[id] - mean) - REVERSION * (prev[id] - 1);
    next[id] = Math.round(Math.min(maxM, Math.max(minM, m)) * 10_000) / 10_000;
  }
  return next;
}

export interface WallstreetDrink {
  id: string;
  name: string;
  color: string | null;
  baseCents: number;
  cents: number;
  m: number;
}
export interface WallstreetState {
  active: true;
  activityId: string;
  activityName: string;
  volatility: Volatility;
  minPct: number;
  maxPct: number;
  tickMs: number;
  tickIndex: number;
  tickAt: Date;
  nextTickAt: Date;
  crashUntil: Date | null;
  drinks: WallstreetDrink[];
}

const activitySelect = {
  id: true,
  name: true,
  status: true,
  wallstreetActive: true,
  wallstreetStartedAt: true,
  wallstreetVolatility: true,
  wallstreetMinPct: true,
  wallstreetMaxPct: true,
  wallstreetProductIds: true,
  wallstreetCrashUntil: true,
} as const;

// The activity whose Wall Street the public page shows: the most recently
// started one that is running.
export async function runningWallstreetActivityId(): Promise<string | null> {
  const a = await prisma.pppActivity.findFirst({
    where: { wallstreetActive: true, status: "OPEN", wallstreetStartedAt: { not: null } },
    orderBy: { wallstreetStartedAt: "desc" },
    select: { id: true },
  });
  return a?.id ?? null;
}

// Current Wall Street state of an activity (computing the current tick if it's
// due), or null when Wall Street isn't running there.
export async function getWallstreet(activityId: string, now = new Date()): Promise<WallstreetState | null> {
  const a = await prisma.pppActivity.findUnique({ where: { id: activityId }, select: activitySelect });
  if (!a || !a.wallstreetActive || a.status !== "OPEN" || !a.wallstreetStartedAt) return null;

  const products = await prisma.pppProduct.findMany({
    where: { id: { in: a.wallstreetProductIds }, archived: false },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, color: true, price: true, specialPrice: true },
  });
  const volatility: Volatility = isVolatility(a.wallstreetVolatility) ? a.wallstreetVolatility : "HIGH";
  const minM = a.wallstreetMinPct / 100;
  const maxM = a.wallstreetMaxPct / 100;
  const base = new Map(products.map((p) => [p.id, p.specialPrice ?? p.price]));

  const startMs = a.wallstreetStartedAt.getTime();
  const index = Math.max(0, Math.floor((now.getTime() - startMs) / TICK_MS));
  let latest = await prisma.pppWallstreetTick.findFirst({ where: { activityId }, orderBy: { index: "desc" } });

  if (!latest || latest.index < index) {
    const prevPrices = (latest?.prices ?? {}) as TickPrices;
    const prev: Record<string, number> = {};
    for (const p of products) prev[p.id] = Math.min(maxM, Math.max(minM, prevPrices[p.id]?.m ?? 1));

    const crash = a.wallstreetCrashUntil != null && a.wallstreetCrashUntil > now;
    let next: Record<string, number>;
    if (crash) {
      next = Object.fromEntries(products.map((p) => [p.id, minM]));
    } else if (!latest) {
      next = prev; // tick 0: the normal prices
    } else {
      next = nextMultipliers(prev, await demandSince(activityId, latest.at, now), volatility, minM, maxM);
    }
    const prices: TickPrices = {};
    for (const p of products) prices[p.id] = { m: next[p.id], c: wsPriceCents(base.get(p.id)!, next[p.id]) };

    try {
      latest = await prisma.pppWallstreetTick.create({
        data: { activityId, index, at: now, prices, crash },
      });
    } catch (e) {
      // Another request computed this tick first — use theirs.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      latest = await prisma.pppWallstreetTick.findFirst({ where: { activityId }, orderBy: { index: "desc" } });
    }
  }

  const prices = (latest!.prices ?? {}) as TickPrices;
  return {
    active: true,
    activityId: a.id,
    activityName: a.name,
    volatility,
    minPct: a.wallstreetMinPct,
    maxPct: a.wallstreetMaxPct,
    tickMs: TICK_MS,
    tickIndex: latest!.index,
    tickAt: latest!.at,
    nextTickAt: new Date(startMs + (index + 1) * TICK_MS),
    crashUntil: a.wallstreetCrashUntil && a.wallstreetCrashUntil > now ? a.wallstreetCrashUntil : null,
    drinks: products.map((p) => {
      const b = base.get(p.id)!;
      const m = prices[p.id]?.m ?? 1;
      return { id: p.id, name: p.name, color: p.color, baseCents: b, cents: prices[p.id]?.c ?? wsPriceCents(b, m), m };
    }),
  };
}

// Drinks sold at the activity since a moment (member orders + external cards).
async function demandSince(activityId: string, from: Date, to: Date): Promise<Record<string, number>> {
  const [member, external] = await Promise.all([
    prisma.pppInvoiceLine.groupBy({
      by: ["productId"],
      where: { invoice: { activityId, confirmedAt: { gt: from, lte: to } } },
      _sum: { quantity: true },
    }),
    prisma.pppExternalLine.groupBy({
      by: ["productId"],
      where: { order: { createdAt: { gt: from, lte: to }, tab: { activityId } } },
      _sum: { quantity: true },
    }),
  ]);
  const d: Record<string, number> = {};
  for (const r of [...member, ...external]) d[r.productId] = (d[r.productId] ?? 0) + (r._sum.quantity ?? 0);
  return d;
}

// Prices to CHARGE for an order at this activity: productId → cents, or null when
// Wall Street isn't running. Uses the tick the POS showed (`shownTick`) when it is
// recent, so a price change between tap and confirm doesn't surprise anyone.
export async function wallstreetChargePrices(
  activityId: string,
  shownTick: unknown
): Promise<Map<string, number> | null> {
  const now = new Date();
  const state = await getWallstreet(activityId, now);
  if (!state) return null;
  const current = new Map(state.drinks.map((d) => [d.id, d.cents]));
  if (typeof shownTick !== "number" || !Number.isInteger(shownTick) || shownTick === state.tickIndex) return current;

  const tick = await prisma.pppWallstreetTick.findUnique({
    where: { activityId_index: { activityId, index: shownTick } },
  });
  if (!tick || tick.index > state.tickIndex || now.getTime() - tick.at.getTime() > PRICE_GRACE_MS + TICK_MS) {
    return current;
  }
  const shown = tick.prices as TickPrices;
  for (const id of current.keys()) if (shown[id]) current.set(id, shown[id].c);
  return current;
}

// Price history for the chart (last hour).
export async function wallstreetHistory(activityId: string) {
  const ticks = await prisma.pppWallstreetTick.findMany({
    where: { activityId, at: { gte: new Date(Date.now() - HISTORY_MS) } },
    orderBy: { index: "asc" },
    select: { index: true, at: true, prices: true, crash: true },
  });
  return ticks.map((t) => ({
    index: t.index,
    at: t.at,
    crash: t.crash,
    prices: Object.fromEntries(Object.entries(t.prices as TickPrices).map(([id, v]) => [id, v.c])),
  }));
}
