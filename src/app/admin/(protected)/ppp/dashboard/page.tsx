"use client";

import { useEffect, useState } from "react";

interface Borrel { id: string; name: string; revenueCents: number; drinks: number; orders: number }
interface Drinker { id: string; name: string; drinks: number; revenueCents: number }
interface Drink { name: string; quantity: number; revenueCents: number }
interface Stats {
  range: string;
  revenueCents: number;
  drinksSold: number;
  orderCount: number;
  borrelCount: number;
  activeDrinkers: number;
  avgOrderCents: number;
  topBorrels: Borrel[];
  topDrinkers: Drinker[];
  topDrinks: Drink[];
}

const RANGES = [
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "365d", label: "1 year" },
  { key: "all", label: "All time" },
];

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;

export default function PppDashboardPage() {
  const [range, setRange] = useState("90d");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/ppp/stats?range=${range}`)
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setLoading(false));
  }, [range]);

  const maxBorrel = Math.max(1, ...(stats?.topBorrels.map((b) => b.revenueCents) ?? [1]));
  const maxDrinker = Math.max(1, ...(stats?.topDrinkers.map((d) => d.drinks) ?? [1]));
  const maxDrink = Math.max(1, ...(stats?.topDrinks.map((d) => d.quantity) ?? [1]));

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">PPP dashboard</h1>
          <p className="text-gray-500">Bar overview — borrels, drinkers & financials</p>
        </div>
        <div className="flex rounded-xl bg-gray-800 p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                range === r.key ? "bg-amber-600 text-white" : "text-gray-300 hover:text-white"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Financials KPIs */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Revenue" value={stats ? euro(stats.revenueCents) : "—"} accent />
        <Kpi label="Drinks sold" value={stats ? String(stats.drinksSold) : "—"} />
        <Kpi label="Orders" value={stats ? String(stats.orderCount) : "—"} />
        <Kpi label="Borrels" value={stats ? String(stats.borrelCount) : "—"} />
        <Kpi label="Drinkers" value={stats ? String(stats.activeDrinkers) : "—"} />
        <Kpi label="Avg. order" value={stats ? euro(stats.avgOrderCents) : "—"} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Top borrels */}
        <Section title="Top borrels (by revenue)">
          {!stats || stats.topBorrels.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-3">
              {stats.topBorrels.map((b, i) => (
                <Bar
                  key={b.id}
                  rank={i + 1}
                  name={b.name}
                  right={`${b.drinks} drinks · ${euro(b.revenueCents)}`}
                  pct={(b.revenueCents / maxBorrel) * 100}
                  color="bg-amber-500"
                />
              ))}
            </ul>
          )}
        </Section>

        {/* Top drinkers */}
        <Section title="Top drinkers (by drinks)">
          {!stats || stats.topDrinkers.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-3">
              {stats.topDrinkers.map((d, i) => (
                <Bar
                  key={d.id}
                  rank={i + 1}
                  name={d.name}
                  right={`${d.drinks} drink${d.drinks === 1 ? "" : "s"} · ${euro(d.revenueCents)}`}
                  pct={(d.drinks / maxDrinker) * 100}
                  color="bg-blue-500"
                />
              ))}
            </ul>
          )}
        </Section>

        {/* Top drinks */}
        <Section title="Most popular drinks">
          {!stats || stats.topDrinks.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-3">
              {stats.topDrinks.map((d, i) => (
                <Bar
                  key={d.name}
                  rank={i + 1}
                  name={d.name}
                  right={`${d.quantity}× · ${euro(d.revenueCents)}`}
                  pct={(d.quantity / maxDrink) * 100}
                  color="bg-green-500"
                />
              ))}
            </ul>
          )}
        </Section>
      </div>

      {loading && <p className="mt-6 text-sm text-gray-600">Loading…</p>}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${accent ? "border-green-700/50 bg-green-900/20" : "border-gray-800 bg-gray-900"}`}>
      <p className="mb-1 text-sm text-gray-400">{label}</p>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
      <h2 className="mb-5 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="text-gray-500">No bar sales in this period.</p>;
}

function Bar({ rank, name, right, pct, color }: { rank: number; name: string; right: string; pct: number; color: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="w-5 text-right text-sm font-bold text-gray-500">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex justify-between gap-2">
          <span className="truncate font-medium">{name}</span>
          <span className="flex-shrink-0 text-sm text-gray-400">{right}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-800">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </li>
  );
}
