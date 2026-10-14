"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// The public Wall Street board: a live line chart of every drink's price, a
// price board with moves, a ticker tape and the market-crash banner. Polls
// /api/wallstreet; built to run full-screen on a TV at the bar.

interface Drink { id: string; name: string; baseCents: number; cents: number; m: number }
interface Tick { index: number; at: string; crash: boolean; prices: Record<string, number> }
interface Market {
  active: true;
  activityName: string;
  tickMs: number;
  tickIndex: number;
  nextTickAt: string;
  crashUntil: string | null;
  serverNow: string;
  drinks: Drink[];
  history: Tick[];
}

const POLL_MS = 3_000;
const WINDOW_MS = 30 * 60_000;
const COLORS = [
  "#22d3ee", "#f472b6", "#a3e635", "#facc15", "#fb923c", "#c084fc",
  "#60a5fa", "#f87171", "#34d399", "#e879f9", "#fde047", "#94a3b8",
];
const euro = (c: number) => `€${(c / 100).toFixed(2)}`;

export default function Board() {
  const [market, setMarket] = useState<Market | null | "closed">(null);
  const [offset, setOffset] = useState(0); // server clock − local clock
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const res = await fetch("/api/wallstreet", { cache: "no-store" });
        if (!res.ok || stop) return;
        const d = await res.json();
        if (!d.active) return setMarket("closed");
        setOffset(Date.parse(d.serverNow) - Date.now());
        setMarket(d);
      } catch {
        /* keep showing the last prices */
      }
    }
    poll();
    const p = setInterval(poll, POLL_MS);
    const c = setInterval(() => setNow(Date.now()), 250);
    return () => {
      stop = true;
      clearInterval(p);
      clearInterval(c);
    };
  }, []);

  if (market === null) return <Screen><p className="text-2xl text-gray-500">Loading the market…</p></Screen>;
  if (market === "closed")
    return (
      <Screen>
        <p className="text-6xl">📉</p>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-white">The market is closed</h1>
        <p className="mt-2 text-lg text-gray-500">Wall Street isn&apos;t running right now — this page starts by itself when it does.</p>
      </Screen>
    );
  return <Live market={market} now={now + offset} />;
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-black px-4 text-center text-white">
      {children}
    </main>
  );
}

function Live({ market, now }: { market: Market; now: number }) {
  const colorOf = useMemo(
    () => new Map(market.drinks.map((d, i) => [d.id, COLORS[i % COLORS.length]])),
    [market.drinks]
  );
  // Move since the previous tick, per drink.
  const prevTick = market.history.length >= 2 ? market.history[market.history.length - 2] : null;
  const moveOf = (d: Drink) => (prevTick?.prices[d.id] != null ? d.cents - prevTick.prices[d.id] : 0);

  const secsLeft = Math.max(0, Math.ceil((Date.parse(market.nextTickAt) - now) / 1000));
  const progress = 1 - Math.min(1, Math.max(0, (Date.parse(market.nextTickAt) - now) / market.tickMs));
  const crashLeft = market.crashUntil ? Math.max(0, Math.ceil((Date.parse(market.crashUntil) - now) / 1000)) : 0;

  return (
    <main className="flex min-h-dvh flex-col overflow-x-hidden bg-black text-white lg:h-dvh lg:overflow-hidden">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="text-3xl">📈</span>
          <div>
            <h1 className="text-xl font-black tracking-tight sm:text-2xl">
              STRESS <span className="text-emerald-400">STOCK EXCHANGE</span>
            </h1>
            <p className="text-sm text-gray-500">{market.activityName}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs uppercase tracking-widest text-gray-500">Next update</p>
            <p className="font-mono text-2xl font-bold tabular-nums">{secsLeft}s</p>
          </div>
          <p className="hidden font-mono text-3xl font-bold tabular-nums text-gray-300 sm:block">
            {new Date(now).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        </div>
      </header>
      <div className="h-1 bg-gray-900">
        <div className="h-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
      </div>

      {crashLeft > 0 && (
        <div className="animate-pulse bg-red-600 px-4 py-3 text-center text-2xl font-black tracking-wide sm:text-4xl">
          💥 MARKET CRASH — EVERYTHING AT ROCK BOTTOM — {crashLeft}s 💥
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row lg:p-6">
        <div className="h-[20rem] min-w-0 flex-none overflow-hidden rounded-2xl border border-gray-800 bg-gray-950 p-2 lg:h-auto lg:min-h-0 lg:flex-1">
          <Chart market={market} now={now} colorOf={colorOf} />
        </div>

        {/* Price board */}
        <ul className="grid grid-cols-1 content-start gap-2 sm:grid-cols-2 lg:w-[26rem] lg:flex-none lg:grid-cols-1 lg:overflow-y-auto">
          {market.drinks.map((d) => {
            const move = moveOf(d);
            const pct = Math.round((d.m - 1) * 100);
            return (
              <li
                key={d.id}
                className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-950 px-4 py-2.5"
                style={{ borderLeft: `6px solid ${colorOf.get(d.id)}` }}
              >
                <span className="min-w-0 flex-1 truncate text-lg font-bold">{d.name}</span>
                <span
                  className={`w-16 text-right font-mono text-sm tabular-nums ${
                    pct > 0 ? "text-red-400" : pct < 0 ? "text-emerald-400" : "text-gray-500"
                  }`}
                >
                  {pct > 0 ? "+" : ""}
                  {pct}%
                </span>
                <span
                  className={`w-24 text-right font-mono text-2xl font-black tabular-nums ${
                    move > 0 ? "text-red-400" : move < 0 ? "text-emerald-400" : "text-white"
                  }`}
                >
                  {move > 0 ? "▲" : move < 0 ? "▼" : ""}
                  {euro(d.cents)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Ticker tape */}
      <div className="overflow-hidden border-t border-gray-800 bg-gray-950 py-2">
        <div className="ws-tape flex w-max gap-10 whitespace-nowrap font-mono text-lg">
          {[0, 1].map((copy) => (
            <span key={copy} className="flex gap-10" aria-hidden={copy === 1}>
              {market.drinks.map((d) => {
                const pct = Math.round((d.m - 1) * 100);
                return (
                  <span key={d.id}>
                    <b className="text-white">{d.name.toUpperCase()}</b>{" "}
                    <span className="text-gray-300">{euro(d.cents)}</span>{" "}
                    <span className={pct > 0 ? "text-red-400" : pct < 0 ? "text-emerald-400" : "text-gray-500"}>
                      {pct > 0 ? "▲ +" : pct < 0 ? "▼ " : "■ "}
                      {pct}%
                    </span>
                  </span>
                );
              })}
            </span>
          ))}
        </div>
      </div>
      <style>{`
        .ws-tape { animation: ws-tape 40s linear infinite; }
        @keyframes ws-tape { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .ws-tape { animation: none; } }
      `}</style>
    </main>
  );
}

// Multi-line price chart (SVG, sized to its container).
function Chart({ market, now, colorOf }: { market: Market; now: number; colorOf: Map<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 400 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: Math.max(200, e.contentRect.width), h: Math.max(200, e.contentRect.height) })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Text scales with the chart, so it stays readable on a big screen.
  const fs = Math.round(Math.min(20, Math.max(12, size.w / 70)));
  const pad = { l: fs * 4.6, r: fs * 6, t: 16, b: fs * 2.2 };
  const ticks = market.history.filter((t) => Date.parse(t.at) >= now - WINDOW_MS);
  const t0 = ticks.length ? Math.min(Date.parse(ticks[0].at), now - 60_000) : now - 60_000;
  const t1 = now;
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of ticks) for (const d of market.drinks) {
    const c = t.prices[d.id];
    if (c != null) {
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
    }
  }
  for (const d of market.drinks) {
    lo = Math.min(lo, d.cents);
    hi = Math.max(hi, d.cents);
  }
  if (!Number.isFinite(lo)) [lo, hi] = [0, 100];
  const span = Math.max(50, hi - lo);
  lo = Math.max(0, lo - span * 0.08);
  hi = hi + span * 0.08;

  const W = size.w - pad.l - pad.r;
  const H = size.h - pad.t - pad.b;
  const x = (ms: number) => pad.l + ((ms - t0) / Math.max(1, t1 - t0)) * W;
  const y = (c: number) => pad.t + (1 - (c - lo) / (hi - lo)) * H;

  // Gridlines at round euro steps.
  const stepC = [5, 10, 20, 25, 50, 100, 200, 500].find((s) => (hi - lo) / s <= 6) ?? 1000;
  const grid: number[] = [];
  for (let c = Math.ceil(lo / stepC) * stepC; c <= hi; c += stepC) grid.push(c);
  const timeTicks: number[] = [];
  const minuteStep = t1 - t0 > 20 * 60_000 ? 5 : t1 - t0 > 8 * 60_000 ? 2 : 1;
  for (let m = Math.ceil(t0 / (minuteStep * 60_000)) * minuteStep * 60_000; m <= t1; m += minuteStep * 60_000) timeTicks.push(m);

  // End labels, pushed apart so they don't overlap.
  const labels = market.drinks
    .map((d) => ({ id: d.id, name: d.name, cents: d.cents, y: y(d.cents) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + fs + 3);
  const overflow = labels.length ? labels[labels.length - 1].y - (pad.t + H) : 0;
  if (overflow > 0) for (const l of labels) l.y -= overflow;

  // Crash periods, shaded.
  const crashBands: [number, number][] = [];
  ticks.forEach((t, i) => {
    if (!t.crash) return;
    const end = i + 1 < ticks.length ? Date.parse(ticks[i + 1].at) : now;
    crashBands.push([Date.parse(t.at), end]);
  });

  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden">
      <svg width={size.w} height={size.h} className="absolute inset-0" role="img" aria-label="Drink prices over time">
        {crashBands.map(([a, b], i) => (
          <rect key={i} x={x(a)} y={pad.t} width={Math.max(1, x(b) - x(a))} height={H} fill="#dc2626" opacity={0.18} />
        ))}
        {grid.map((c) => (
          <g key={c}>
            <line x1={pad.l} x2={pad.l + W} y1={y(c)} y2={y(c)} stroke="#1f2937" />
            <text x={pad.l - 8} y={y(c) + fs / 3} textAnchor="end" fontSize={fs} fill="#6b7280" fontFamily="monospace">
              {euro(c)}
            </text>
          </g>
        ))}
        {timeTicks.map((m) => (
          <text key={m} x={x(m)} y={size.h - 8} textAnchor="middle" fontSize={fs} fill="#6b7280" fontFamily="monospace">
            {new Date(m).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
          </text>
        ))}
        {market.drinks.map((d) => {
          const pts = ticks
            .filter((t) => t.prices[d.id] != null)
            .map((t) => [x(Date.parse(t.at)), y(t.prices[d.id])] as const);
          pts.push([x(now), y(d.cents)]);
          const path = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
          const color = colorOf.get(d.id)!;
          return (
            <g key={d.id}>
              <path d={path} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(now)} cy={y(d.cents)} r={4.5} fill={color} />
            </g>
          );
        })}
        {labels.map((l) => (
          <text key={l.id} x={pad.l + W + 8} y={l.y + fs / 3} fontSize={fs} fontWeight={700} fill={colorOf.get(l.id)} fontFamily="monospace">
            {euro(l.cents)}
          </text>
        ))}
      </svg>
    </div>
  );
}
