"use client";

import { useEffect, useState } from "react";

interface TopProduct { id: string; name: string; quantity: number; revenueCents: number }
interface TopSpender { id: string; name: string; spentCents: number; orderCount: number }
interface RecentPurchase {
  id: string;
  memberName: string;
  at: string;
  totalCents: number;
  items: { name: string; quantity: number }[];
}
interface Stats {
  range: string;
  revenueCents: number;
  orderCount: number;
  itemsSold: number;
  avgOrderCents: number;
  activeUsers: number;
  topProducts: TopProduct[];
  topSpenders: TopSpender[];
  recentPurchases: RecentPurchase[];
  series: { date: string; revenueCents: number }[];
}

const RANGES: { key: string; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "365d", label: "1 year" },
  { key: "all", label: "All time" },
];

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function DashboardPage() {
  const [range, setRange] = useState("30d");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/stats?range=${range}`)
      .then((r) => r.json())
      .then((d) => setStats(d))
      .finally(() => setLoading(false));
  }, [range]);

  const maxRevenue = Math.max(1, ...(stats?.series.map((s) => s.revenueCents) ?? [1]));
  const maxQty = Math.max(1, ...(stats?.topProducts.map((p) => p.quantity) ?? [1]));
  const maxSpent = Math.max(1, ...(stats?.topSpenders.map((s) => s.spentCents) ?? [1]));

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-gray-500">Sales overview</p>
        </div>
        <div className="flex rounded-xl bg-gray-800 p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                range === r.key ? "bg-blue-600 text-white" : "text-gray-300 hover:text-white"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Revenue" value={stats ? euro(stats.revenueCents) : "—"} accent />
        <Kpi label="Active users" value={stats ? String(stats.activeUsers) : "—"} />
        <Kpi label="Orders" value={stats ? String(stats.orderCount) : "—"} />
        <Kpi label="Items sold" value={stats ? String(stats.itemsSold) : "—"} />
        <Kpi label="Avg. order" value={stats ? euro(stats.avgOrderCents) : "—"} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Revenue chart */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-5 text-lg font-semibold">Revenue over time</h2>
          {!stats || stats.series.length === 0 ? (
            <p className="text-gray-500">No sales in this period.</p>
          ) : (
            <div className="flex h-48 gap-1">
              {stats.series.map((s) => (
                <div key={s.date} className="group relative flex h-full flex-1 flex-col items-center justify-end">
                  <div
                    className="w-full rounded-t bg-blue-600 transition-all group-hover:bg-blue-400"
                    style={{ height: `${(s.revenueCents / maxRevenue) * 100}%`, minHeight: s.revenueCents > 0 ? 2 : 0 }}
                  />
                  <div className="pointer-events-none absolute -top-9 z-10 hidden whitespace-nowrap rounded bg-gray-700 px-2 py-1 text-xs group-hover:block">
                    {new Date(s.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: {euro(s.revenueCents)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Top products */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-5 text-lg font-semibold">Most popular items</h2>
          {!stats || stats.topProducts.length === 0 ? (
            <p className="text-gray-500">No sales in this period.</p>
          ) : (
            <ul className="space-y-3">
              {stats.topProducts.map((p, i) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="w-5 text-right text-sm font-bold text-gray-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex justify-between gap-2">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="flex-shrink-0 text-sm text-gray-400">
                        {p.quantity}× · {euro(p.revenueCents)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full rounded-full bg-green-500"
                        style={{ width: `${(p.quantity / maxQty) * 100}%` }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Top spenders */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-5 text-lg font-semibold">Top spenders</h2>
          {!stats || stats.topSpenders.length === 0 ? (
            <p className="text-gray-500">No sales in this period.</p>
          ) : (
            <ul className="space-y-3">
              {stats.topSpenders.map((s, i) => (
                <li key={s.id} className="flex items-center gap-3">
                  <span className="w-5 text-right text-sm font-bold text-gray-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex justify-between gap-2">
                      <span className="truncate font-medium">{s.name}</span>
                      <span className="flex-shrink-0 text-sm text-gray-400">
                        {euro(s.spentCents)} · {s.orderCount} order{s.orderCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full rounded-full bg-purple-500"
                        style={{ width: `${(s.spentCents / maxSpent) * 100}%` }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent purchases */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-5 text-lg font-semibold">Recent purchases</h2>
          {!stats || stats.recentPurchases.length === 0 ? (
            <p className="text-gray-500">No purchases in this period.</p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {stats.recentPurchases.map((p) => (
                <li key={p.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{p.memberName}</span>
                      <span className="flex-shrink-0 text-xs text-gray-500">{timeAgo(p.at)}</span>
                    </div>
                    <p className="truncate text-sm text-gray-400">
                      {p.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                    </p>
                  </div>
                  <span className="flex-shrink-0 font-semibold tabular-nums">{euro(p.totalCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
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
