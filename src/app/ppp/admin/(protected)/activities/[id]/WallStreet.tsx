"use client";

import { useCallback, useEffect, useState } from "react";

// Wall Street mode for this borrel: pick the drinks and the volatility, start /
// stop the market, trigger a crash, and watch the live prices. The public board
// is at /wallstreet.

type Volatility = "LOW" | "MEDIUM" | "HIGH";
interface Settings {
  wallstreetActive: boolean;
  wallstreetVolatility: Volatility;
  wallstreetMinPct: number;
  wallstreetMaxPct: number;
  wallstreetProductIds: string[];
}
interface ProductLite { id: string; name: string; price: number; specialPrice: number | null; category: { name: string } }
interface Live {
  tickIndex: number;
  nextTickAt: string;
  crashUntil: string | null;
  drinks: { id: string; name: string; baseCents: number; cents: number; m: number }[];
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const VOLATILITY: { value: Volatility; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High (wild)" },
];

export default function WallStreet({ activityId, isOpen }: { activityId: string; isOpen: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [form, setForm] = useState({ volatility: "HIGH" as Volatility, minPct: "50", maxPct: "200", ids: new Set<string>() });
  const [busy, setBusy] = useState(false);
  // Collapsed until clicked (most borrels don't use it); the buttons stay visible.
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (resetForm = false) => {
      const res = await fetch(`/api/admin/ppp/activities/${activityId}/wallstreet`);
      if (!res.ok) return;
      const d = await res.json();
      setSettings(d.settings);
      setProducts(d.products);
      setLive(d.live);
      if (resetForm) {
        const ids: string[] = d.settings.wallstreetProductIds;
        setForm({
          volatility: d.settings.wallstreetVolatility,
          minPct: String(d.settings.wallstreetMinPct),
          maxPct: String(d.settings.wallstreetMaxPct),
          // First time: every drink selected.
          ids: new Set(ids.length > 0 ? ids : d.products.map((p: ProductLite) => p.id)),
        });
      }
    },
    [activityId]
  );
  useEffect(() => {
    load(true);
  }, [load]);
  // Live prices while running.
  useEffect(() => {
    if (!settings?.wallstreetActive) return;
    const t = setInterval(() => load(), 5_000);
    return () => clearInterval(t);
  }, [settings?.wallstreetActive, load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/ppp/activities/${activityId}/wallstreet`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not save");
      return false;
    }
    await load();
    return true;
  }

  const formBody = () => ({
    volatility: form.volatility,
    minPct: Number(form.minPct),
    maxPct: Number(form.maxPct),
    productIds: [...form.ids],
  });

  if (!settings) return null;
  const running = settings.wallstreetActive;
  const toggle = (id: string) =>
    setForm((f) => {
      const ids = new Set(f.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { ...f, ids };
    });
  const categories = [...new Set(products.map((p) => p.category.name))];

  return (
    <section
      className={`mb-6 max-w-5xl rounded-2xl border p-6 ${
        running ? "border-emerald-700/60 bg-emerald-950/20" : "border-gray-800 bg-gray-900"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex cursor-pointer items-center gap-2 text-lg font-semibold" onClick={() => setOpen((o) => !o)}>
          📈 Wall Street mode
          <span className="text-sm font-normal text-gray-500">{open ? "▴ hide" : "▾ show"}</span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              running ? "bg-emerald-500/20 text-emerald-300" : "bg-gray-700/40 text-gray-400"
            }`}
          >
            {running ? "Running" : "Off"}
          </span>
          {live?.crashUntil && (
            <span className="animate-pulse rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white">💥 CRASH</span>
          )}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/wallstreet"
            target="_blank"
            className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
          >
            Open board ↗
          </a>
          {running && (
            <button
              onClick={() => confirm("Crash the market? Every drink drops to the floor price for 1 minute.") && patch({ crash: true })}
              disabled={busy || !!live?.crashUntil}
              className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40"
            >
              💥 Crash (1 min)
            </button>
          )}
          {running ? (
            <button
              onClick={() => confirm("Stop Wall Street? Drinks go back to their normal prices.") && patch({ active: false })}
              disabled={busy}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-700 disabled:opacity-40"
            >
              ■ Stop
            </button>
          ) : (
            <button
              onClick={() => patch({ ...formBody(), active: true })}
              disabled={busy || !isOpen || form.ids.size < 2}
              title={!isOpen ? "Reopen the activity first" : undefined}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              ▶ Start Wall Street
            </button>
          )}
        </div>
      </div>
      {open && (
      <>
      <p className="mb-4 mt-1 text-sm text-gray-500">
        Prices of the selected drinks move every 20 seconds with demand: what sells goes up, the rest goes down, plus
        random swings. They replace the normal price and borrel specials at the POS; role discounts and bartender free
        drinks still apply, and orders are charged the price the bartender saw. External cards keep normal prices.
        Show <a href="/wallstreet" target="_blank" className="text-amber-400 hover:underline">ppp.51vo.nl/wallstreet</a>{" "}
        on a screen at the bar.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">Volatility</span>
          <select
            value={form.volatility}
            onChange={(e) => setForm((f) => ({ ...f, volatility: e.target.value as Volatility }))}
            className="rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
          >
            {VOLATILITY.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">Floor (% of normal)</span>
          <input
            type="number" min={10} max={100} step={5} value={form.minPct}
            onChange={(e) => setForm((f) => ({ ...f, minPct: e.target.value }))}
            className="w-28 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">Ceiling (% of normal)</span>
          <input
            type="number" min={100} max={500} step={10} value={form.maxPct}
            onChange={(e) => setForm((f) => ({ ...f, maxPct: e.target.value }))}
            className="w-28 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
          />
        </label>
        {running && (
          <button
            onClick={() => patch(formBody())}
            disabled={busy || form.ids.size < 2}
            className="rounded-xl bg-amber-600 px-5 py-2 text-sm font-semibold hover:bg-amber-500 disabled:opacity-40"
          >
            Save (applies from the next tick)
          </button>
        )}
      </div>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-3 text-xs">
            <span className="font-semibold uppercase tracking-wide text-gray-400">Drinks ({form.ids.size})</span>
            <button onClick={() => setForm((f) => ({ ...f, ids: new Set(products.map((p) => p.id)) }))} className="text-amber-400 hover:underline">
              all
            </button>
            <button onClick={() => setForm((f) => ({ ...f, ids: new Set() }))} className="text-amber-400 hover:underline">
              none
            </button>
          </div>
          <div className="max-h-72 space-y-3 overflow-y-auto pr-2">
            {categories.map((c) => (
              <div key={c}>
                <p className="mb-1 text-xs text-gray-500">{c}</p>
                {products
                  .filter((p) => p.category.name === c)
                  .map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                      <input type="checkbox" checked={form.ids.has(p.id)} onChange={() => toggle(p.id)} className="accent-emerald-500" />
                      <span className="flex-1">{p.name}</span>
                      <span className="tabular-nums text-gray-500">{euro(p.specialPrice ?? p.price)}</span>
                    </label>
                  ))}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Live prices {live && <span className="font-normal normal-case text-gray-600">· tick {live.tickIndex}</span>}
          </p>
          {!live ? (
            <p className="text-sm text-gray-500">{running ? "Loading…" : "Start Wall Street to see live prices."}</p>
          ) : (
            <ul className="space-y-1">
              {live.drinks.map((d) => {
                const pct = Math.round((d.m - 1) * 100);
                return (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{d.name}</span>
                    <span className="tabular-nums text-gray-500 line-through">{euro(d.baseCents)}</span>
                    <span className="w-16 text-right font-semibold tabular-nums">{euro(d.cents)}</span>
                    <span
                      className={`w-14 text-right text-xs tabular-nums ${
                        pct > 0 ? "text-red-400" : pct < 0 ? "text-emerald-400" : "text-gray-500"
                      }`}
                    >
                      {pct > 0 ? "+" : ""}
                      {pct}%
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      </>
      )}
    </section>
  );
}
