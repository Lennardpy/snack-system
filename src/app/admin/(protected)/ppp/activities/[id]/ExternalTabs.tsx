"use client";

import { useCallback, useEffect, useState } from "react";
import { PRICE_LEVELS, type ExternalBreakdown, type ExternalPriceLevel } from "@/lib/external";

// External cards used at this borrel: one tab per card. The admin sets the PDF
// title and the price level, checks the breakdown and downloads the PDF.

interface Tab {
  id: string;
  title: string | null;
  priceLevel: ExternalPriceLevel;
  cardName: string;
  cardUid: string | null;
  cardLimitCents: number | null; // the card's spending limit per borrel (internal prices)
  activity: { id: string; name: string; date: string };
  breakdown: ExternalBreakdown;
  internalInclCents: number;
  abProfitCents: number;
  orders: {
    id: string;
    createdAt: string;
    by: string | null;
    lines: { name: string; quantity: number; unitCents: number }[];
  }[];
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;

export default function ExternalTabs({ activityId, onChanged }: { activityId: string; onChanged: () => void }) {
  const [tabs, setTabs] = useState<Tab[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/ppp/activities/${activityId}/external`);
    if (res.ok) setTabs((await res.json()).tabs);
  }, [activityId]);
  useEffect(() => {
    load();
  }, [load]);

  async function patch(tab: Tab, body: { title?: string; priceLevel?: ExternalPriceLevel }) {
    const res = await fetch(`/api/admin/ppp/external-tabs/${tab.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return alert((await res.json().catch(() => ({}))).error ?? "Could not save");
    await load();
    if (body.priceLevel) onChanged(); // revenue in the P/L changes with the level
  }

  async function removeOrder(orderId: string) {
    if (!confirm("Remove this order from the external tab?")) return;
    const res = await fetch(`/api/admin/ppp/external-orders/${orderId}`, { method: "DELETE" });
    if (!res.ok) return alert((await res.json().catch(() => ({}))).error ?? "Could not remove");
    await load();
    onChanged();
  }

  return (
    <section className="mb-6 max-w-5xl rounded-2xl border border-gray-800 bg-gray-900 p-6">
      <h2 className="mb-1 text-lg font-semibold">External cards</h2>
      <p className="mb-4 text-sm text-gray-500">
        Drinks tapped on an external card (not linked to a member) — invoiced outside Congressus. Set a title and price
        level, then download the PDF. Prices are the internal selling price × the level, incl. VAT. The internal-price
        part counts in this borrel&apos;s profit/loss; the markup above it is <b>AB profit</b> (on the dashboard, not in
        the P/L). Manage the cards
        under{" "}
        <a href="/admin/ppp/external-cards" className="text-amber-400 hover:underline">
          External cards
        </a>
        .
      </p>

      {tabs === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : tabs.length === 0 ? (
        <p className="text-sm text-gray-500">No external cards were used at this borrel.</p>
      ) : (
        <div className="space-y-5">
          {tabs.map((t) => (
            <TabCard key={t.id} tab={t} onPatch={(b) => patch(t, b)} onRemoveOrder={removeOrder} />
          ))}
        </div>
      )}
    </section>
  );
}

function TabCard({
  tab,
  onPatch,
  onRemoveOrder,
}: {
  tab: Tab;
  onPatch: (b: { title?: string; priceLevel?: ExternalPriceLevel }) => void;
  onRemoveOrder: (id: string) => void;
}) {
  const [title, setTitle] = useState(tab.title ?? "");
  const [showOrders, setShowOrders] = useState(false);
  useEffect(() => setTitle(tab.title ?? ""), [tab.title]);
  const b = tab.breakdown;
  const titleDirty = title.trim() !== (tab.title ?? "");

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          🏷️ {tab.cardName}
          <span className="ml-2 text-xs font-normal text-gray-500">
            {b.drinks} drink{b.drinks === 1 ? "" : "s"} · {tab.orders.length} order{tab.orders.length === 1 ? "" : "s"}
            {tab.cardLimitCents != null && (
              <span className={tab.internalInclCents >= tab.cardLimitCents ? "text-red-400" : ""}>
                {" "}· {euro(tab.internalInclCents)} of {euro(tab.cardLimitCents)} limit used
                {tab.internalInclCents >= tab.cardLimitCents ? " (limit reached)" : ""}
              </span>
            )}
          </span>
        </p>
        <div className="text-right">
          <p className="text-xl font-bold tabular-nums">
            {euro(b.totalInclCents)} <span className="text-xs font-normal text-gray-500">incl. VAT</span>
          </p>
          {tab.abProfitCents > 0 && (
            <p className="text-xs text-gray-500">
              {euro(tab.internalInclCents)} internal (P/L) +{" "}
              <span className="text-green-400">{euro(tab.abProfitCents)} AB profit</span>
            </p>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <span className="text-xs text-gray-400">Title (on the PDF)</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => titleDirty && onPatch({ title })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            placeholder={`${tab.cardName} — ${tab.activity.name}`}
            maxLength={120}
            className="rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">Price level</span>
          <select
            value={tab.priceLevel}
            onChange={(e) => onPatch({ priceLevel: e.target.value as ExternalPriceLevel })}
            className="rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
          >
            {PRICE_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <a
          href={`/api/admin/ppp/external-tabs/${tab.id}/pdf`}
          aria-disabled={titleDirty}
          onClick={(e) => {
            // Save a typed-but-unsaved title first, so the PDF has it.
            if (titleDirty) {
              e.preventDefault();
              onPatch({ title });
            }
          }}
          className="rounded-xl bg-amber-600 px-5 py-2 text-sm font-semibold hover:bg-amber-500"
        >
          {titleDirty ? "Save title" : "⬇ Download PDF"}
        </a>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2">Drink</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit excl.</th>
              <th className="py-2 text-right">Unit incl.</th>
              <th className="py-2 text-right">VAT</th>
              <th className="py-2 text-right">Total excl.</th>
              <th className="py-2 text-right">Total incl.</th>
            </tr>
          </thead>
          <tbody>
            {b.lines.map((l) => (
              <tr key={`${l.productId}-${l.unitInclCents}-${l.vatRate}`} className="border-b border-gray-800/60">
                <td className="py-2">{l.name}</td>
                <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="py-2 text-right tabular-nums text-gray-400">{euro(l.unitExclCents)}</td>
                <td className="py-2 text-right tabular-nums">{euro(l.unitInclCents)}</td>
                <td className="py-2 text-right tabular-nums text-gray-500">{l.vatRate}%</td>
                <td className="py-2 text-right tabular-nums text-gray-400">{euro(l.totalExclCents)}</td>
                <td className="py-2 text-right font-medium tabular-nums">{euro(l.totalInclCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-sm">
            <tr>
              <td colSpan={5} className="pt-3 text-right text-gray-400">Total excl. VAT</td>
              <td colSpan={2} className="pt-3 text-right tabular-nums">{euro(b.totalExclCents)}</td>
            </tr>
            {b.vatByRate.map((r) => (
              <tr key={r.rate}>
                <td colSpan={5} className="text-right text-gray-400">
                  VAT {r.rate}% over {euro(r.baseCents)}
                </td>
                <td colSpan={2} className="text-right tabular-nums">{euro(r.vatCents)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} className="pt-1 text-right font-semibold">Total incl. VAT</td>
              <td colSpan={2} className="pt-1 text-right font-bold tabular-nums">{euro(b.totalInclCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <button
        onClick={() => setShowOrders((v) => !v)}
        className="mt-3 text-xs text-gray-500 hover:text-gray-300"
      >
        {showOrders ? "▾ Hide orders" : `▸ Show orders (${tab.orders.length})`}
      </button>
      {showOrders && (
        <ul className="mt-2 space-y-1.5">
          {tab.orders.map((o) => (
            <li key={o.id} className="flex items-center gap-3 rounded-lg bg-gray-900 px-3 py-2 text-sm">
              <span className="w-12 flex-shrink-0 tabular-nums text-gray-500">
                {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {o.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")}
                {o.by && <span className="text-gray-500"> · by {o.by}</span>}
              </span>
              <button
                onClick={() => onRemoveOrder(o.id)}
                className="rounded-lg bg-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:bg-red-600 hover:text-white"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
