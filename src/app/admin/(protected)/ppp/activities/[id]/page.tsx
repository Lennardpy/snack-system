"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SBZ_PRODUCTS, type SbzSection } from "@/lib/sbz";

interface ProductLite { id: string; name: string; price: number; specialPrice: number | null }
interface Discount { id: string; productId: string; priceCents: number; product: ProductLite }
interface Activity {
  id: string;
  name: string;
  status: "OPEN" | "CLOSED";
  discountsActive: boolean;
  discounts: Discount[];
}
interface RoleCost { name: string; costCents: number; drinks: number }
interface DrinkRow { name: string; quantity: number; revenueCents: number; discountCents: number }

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const toCents = (s: string) => Math.max(0, Math.round(Number(s) * 100));

const SECTIONS: SbzSection[] = ["Beer", "Soft drinks", "Other", "On request"];

export default function ActivityDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [pnl, setPnl] = useState({
    orders: 0,
    memberRevenueCents: 0,
    specialsDiscountCents: 0,
    totalDiscountCents: 0,
    bartenderCostCents: 0,
    bartenderDrinks: 0,
    cogsInclCents: 0,
    cogsExclCents: 0,
    roleCosts: [] as RoleCost[],
    perDrink: [] as DrinkRow[],
  });
  const [usage, setUsage] = useState<Record<string, string>>({});
  const [savingUsage, setSavingUsage] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState("");
  const [unmatched, setUnmatched] = useState<{ name: string; quantity: number; isKeg: boolean }[]>([]);
  const [sumup, setSumup] = useState<
    | { state: "loading" | "unavailable" }
    | { state: "ok"; revenueCents: number; count: number; byDrink: { name: string; quantity: number; revenueCents: number }[] }
  >({ state: "loading" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // add-special form
  const [productId, setProductId] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/ppp/activities/${id}`);
    if (res.ok) {
      const d = await res.json();
      setActivity(d.activity);
      setProducts(d.products);
      setPnl({
        orders: d.orderCount ?? 0,
        memberRevenueCents: d.memberRevenueCents ?? 0,
        specialsDiscountCents: d.specialsDiscountCents ?? 0,
        totalDiscountCents: d.totalDiscountCents ?? 0,
        bartenderCostCents: d.bartenderCostCents ?? 0,
        bartenderDrinks: d.bartenderDrinks ?? 0,
        cogsInclCents: d.cogsInclCents ?? 0,
        cogsExclCents: d.cogsExclCents ?? 0,
        roleCosts: d.roleCosts ?? [],
        perDrink: d.perDrink ?? [],
      });
      const u: Record<string, string> = {};
      for (const e of d.usage ?? []) u[e.sbzKey] = String(e.quantity);
      setUsage(u);
    }
    setLoading(false);
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  // Card revenue from SumUp, loaded separately (external call).
  useEffect(() => {
    setSumup({ state: "loading" });
    fetch(`/api/admin/ppp/activities/${id}/sumup`)
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d) =>
        d.available
          ? setSumup({ state: "ok", revenueCents: d.revenueCents, count: d.count, byDrink: d.byDrink ?? [] })
          : setSumup({ state: "unavailable" })
      )
      .catch(() => setSumup({ state: "unavailable" }));
  }, [id]);

  // Live cost-of-goods from the usage form inputs (headline = incl. BTW).
  const liveCogsCents = useMemo(() => {
    let c = 0;
    for (const p of SBZ_PRODUCTS) {
      const q = Number(usage[p.key]);
      if (Number.isFinite(q) && q > 0) c += Math.round(p.costInclCents * q);
    }
    return c;
  }, [usage]);

  const cardRevenueCents = sumup.state === "ok" ? sumup.revenueCents : 0;
  const totalRevenueCents = pnl.memberRevenueCents + cardRevenueCents;
  const netPlCents = totalRevenueCents - liveCogsCents;

  // Per-drink: member charges + SumUp card sales, merged by drink name.
  const mergedDrinks = useMemo(() => {
    const m = new Map<
      string,
      { name: string; memberQty: number; memberRev: number; discount: number; cardQty: number; cardRev: number }
    >();
    for (const d of pnl.perDrink) {
      m.set(d.name, { name: d.name, memberQty: d.quantity, memberRev: d.revenueCents, discount: d.discountCents, cardQty: 0, cardRev: 0 });
    }
    if (sumup.state === "ok") {
      for (const c of sumup.byDrink) {
        const e = m.get(c.name) ?? { name: c.name, memberQty: 0, memberRev: 0, discount: 0, cardQty: 0, cardRev: 0 };
        e.cardQty += c.quantity;
        e.cardRev += c.revenueCents;
        m.set(c.name, e);
      }
    }
    return [...m.values()].sort((a, b) => b.memberRev + b.cardRev - (a.memberRev + a.cardRev));
  }, [pnl.perDrink, sumup]);

  const available = useMemo(() => {
    const taken = new Set((activity?.discounts ?? []).map((d) => d.productId));
    return products.filter((p) => !taken.has(p.id));
  }, [products, activity]);

  async function patchActivity(body: Record<string, unknown>) {
    const res = await fetch(`/api/ppp/activities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) load();
    else alert((await res.json()).error ?? "Update failed");
  }

  async function saveUsage() {
    setSavingUsage(true);
    const payload = SBZ_PRODUCTS.map((p) => ({ sbzKey: p.key, quantity: Number(usage[p.key]) || 0 })).filter(
      (e) => e.quantity > 0
    );
    const res = await fetch(`/api/admin/ppp/activities/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usage: payload }),
    });
    setSavingUsage(false);
    if (res.ok) load();
    else alert((await res.json()).error ?? "Could not save usage");
  }

  // Import an Alexia usage PDF: extract the numbers and pre-fill the form (the
  // file is parsed server-side in memory and not stored). The admin reviews, maps
  // any unmatched items, then Saves.
  async function importPdf(file: File) {
    setImporting(true);
    setImportNote("");
    setUnmatched([]);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/admin/ppp/activities/${id}/import`, { method: "POST", body: fd });
    setImporting(false);
    const d = await res.json();
    if (!res.ok) {
      setImportNote(d.error ?? "Import failed");
      return;
    }
    setUsage((u) => {
      const next = { ...u };
      // Add onto whatever is already in the form (so uploading a second document
      // accumulates), rounding to drop floating-point noise.
      for (const m of d.matched as { sbzKey: string; quantity: number }[]) {
        const cur = Number(next[m.sbzKey]) || 0;
        next[m.sbzKey] = String(Math.round((cur + m.quantity) * 1000) / 1000);
      }
      return next;
    });
    setUnmatched(d.unmatched ?? []);
    setImportNote(
      `Added ${d.matched.length} item${d.matched.length === 1 ? "" : "s"} to the form — review below, then Save usage.` +
        (d.unmatched?.length ? ` ${d.unmatched.length} couldn't be matched — assign them below.` : "")
    );
  }

  // Assign an unmatched imported line to an SBZ product (adds onto its input).
  function assignUnmatched(line: { name: string; quantity: number }, sbzKey: string) {
    if (sbzKey)
      setUsage((u) => {
        const cur = Number(u[sbzKey]) || 0;
        return { ...u, [sbzKey]: String(Math.round((cur + line.quantity) * 1000) / 1000) };
      });
    setUnmatched((list) => list.filter((l) => l !== line));
  }

  async function addSpecial(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || price.trim() === "") return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/ppp/activities/${id}/discounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, priceCents: toCents(price) }),
    });
    setBusy(false);
    if (res.ok) {
      setProductId("");
      setPrice("");
      load();
    } else {
      setError((await res.json()).error ?? "Could not add special");
    }
  }

  async function removeSpecial(d: Discount) {
    const res = await fetch(`/api/admin/ppp/activities/${id}/discounts?productId=${d.productId}`, { method: "DELETE" });
    if (res.ok) load();
  }

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;
  if (!activity) return <div className="p-8 text-gray-500">Activity not found.</div>;

  return (
    <div className="p-8">
      <button onClick={() => router.push("/admin/ppp/activities")} className="mb-4 text-sm text-gray-500 hover:text-gray-300">
        ← All activities
      </button>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{activity.name}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              activity.status === "OPEN" ? "bg-green-500/15 text-green-400" : "bg-gray-700/40 text-gray-400"
            }`}
          >
            {activity.status === "OPEN" ? "Open" : "Closed"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const n = prompt("Rename activity", activity.name);
              if (n && n.trim() && n.trim() !== activity.name) patchActivity({ name: n.trim() });
            }}
            className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            Rename
          </button>
          <button
            onClick={() => patchActivity({ status: activity.status === "OPEN" ? "CLOSED" : "OPEN" })}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              activity.status === "OPEN" ? "bg-gray-800 text-gray-300 hover:bg-red-600 hover:text-white" : "bg-green-600/80 text-white hover:bg-green-600"
            }`}
          >
            {activity.status === "OPEN" ? "Close" : "Reopen"}
          </button>
        </div>
      </div>

      {/* ── Profit / loss ─────────────────────────────────────────────────── */}
      <section className="mb-6 max-w-5xl rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-1 text-lg font-semibold">Profit / loss</h2>
        <p className="mb-5 text-sm text-gray-500">
          Revenue (member charges + SumUp card) minus the cost of goods you enter below.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Member charges" value={euro(pnl.memberRevenueCents)} hint={`${pnl.orders} order${pnl.orders === 1 ? "" : "s"} (billed via Congressus)`} />
          <Stat
            label="Card revenue (SumUp)"
            value={
              sumup.state === "loading" ? "…" : sumup.state === "ok" ? euro(sumup.revenueCents) : "n/a"
            }
            hint={
              sumup.state === "ok"
                ? `${sumup.count} card payment${sumup.count === 1 ? "" : "s"}`
                : sumup.state === "unavailable"
                ? "SumUp unavailable"
                : "loading…"
            }
          />
          <Stat label="Cost of goods" value={`− ${euro(liveCogsCents)}`} hint="from SBZ usage (incl. BTW)" />
          <Stat
            label="Net profit / loss"
            value={`${netPlCents < 0 ? "−" : ""}${euro(Math.abs(netPlCents))}`}
            hint={`revenue ${euro(totalRevenueCents)} − cost ${euro(liveCogsCents)}`}
            accent={netPlCents >= 0 ? "green" : "red"}
          />
        </div>

        {/* Discounts given — already reflected in member charges; shown for insight */}
        <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/40 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Discounts given (the association&apos;s cost — already reflected in member charges)
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>Drink specials: <b className="tabular-nums">{euro(pnl.specialsDiscountCents)}</b></span>
            <span>Bartender free drinks: <b className="tabular-nums">{euro(pnl.bartenderCostCents)}</b>{pnl.bartenderDrinks > 0 && <span className="text-gray-500"> ({pnl.bartenderDrinks})</span>}</span>
            {pnl.roleCosts.map((r) => (
              <span key={r.name}>{r.name}: <b className="tabular-nums">{euro(r.costCents)}</b></span>
            ))}
            <span className="text-gray-500">Total discount: {euro(pnl.totalDiscountCents)}</span>
          </div>
        </div>
      </section>

      {/* ── Usage (cost of goods input) ───────────────────────────────────── */}
      <section className="mb-6 max-w-5xl rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Usage (SBZ)</h2>
          <div className="flex items-center gap-2">
            <label
              className={`cursor-pointer rounded-xl bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700 ${
                importing ? "opacity-50" : ""
              }`}
            >
              {importing ? "Reading…" : "⇪ Import Alexia PDF"}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importPdf(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              onClick={saveUsage}
              disabled={savingUsage}
              className="rounded-xl bg-amber-600 px-5 py-2 text-sm font-semibold transition-colors hover:bg-amber-500 disabled:opacity-40"
            >
              {savingUsage ? "Saving…" : "Save usage"}
            </button>
          </div>
        </div>
        <p className="mb-3 text-sm text-gray-500">
          Enter what was used, or <b>Import</b> the Alexia usage PDF to auto-fill — a second upload <b>adds
          onto</b> the current values. <b>Kegs in kg</b> (≈ liters), <b>bottles/cans/shots as units</b>. Cost is
          the SBZ invoice price (incl. BTW).
        </p>
        {importNote && (
          <p className="mb-4 rounded-lg bg-gray-950/60 px-3 py-2 text-sm text-amber-200">{importNote}</p>
        )}
        {unmatched.length > 0 && (
          <div className="mb-5 rounded-xl border border-amber-800/40 bg-amber-900/10 p-4">
            <p className="mb-2 text-sm font-medium text-amber-300">
              Couldn&apos;t match {unmatched.length} line{unmatched.length === 1 ? "" : "s"} — assign a product:
            </p>
            <ul className="space-y-2">
              {unmatched.map((u, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {u.name} <span className="text-gray-500">· {u.quantity}{u.isKeg ? " kg" : "×"}</span>
                  </span>
                  <select
                    defaultValue=""
                    onChange={(e) => assignUnmatched(u, e.target.value)}
                    className="rounded-lg bg-gray-800 px-2 py-1 outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">Ignore</option>
                    {SBZ_PRODUCTS.filter((p) => p.unit === (u.isKeg ? "LITER" : "UNIT")).map((p) => (
                      <option key={p.key} value={p.key}>{p.name}</option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {SECTIONS.map((section) => {
            const items = SBZ_PRODUCTS.filter((p) => p.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">{section}</h3>
                <div className="space-y-1.5">
                  {items.map((p) => {
                    const q = Number(usage[p.key]) || 0;
                    const lineCost = q > 0 ? Math.round(p.costInclCents * q) : 0;
                    return (
                      <div key={p.key} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
                        <input
                          type="number"
                          min={0}
                          step={p.unit === "LITER" ? 0.1 : 1}
                          value={usage[p.key] ?? ""}
                          onChange={(e) => setUsage((u) => ({ ...u, [p.key]: e.target.value }))}
                          placeholder="0"
                          className="w-20 rounded-lg bg-gray-800 px-2 py-1 text-right outline-none focus:ring-2 focus:ring-amber-500"
                        />
                        <span className="w-8 text-xs text-gray-500">{p.unit === "LITER" ? "kg" : "×"}</span>
                        <span className="w-16 text-right text-xs text-gray-400 tabular-nums">{lineCost > 0 ? euro(lineCost) : ""}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end border-t border-gray-800 pt-3 text-sm">
          <span>Cost of goods (unsaved live): <b className="tabular-nums">{euro(liveCogsCents)}</b></span>
        </div>
      </section>

      {/* ── Per-drink breakdown (member charges + SumUp card) ─────────────── */}
      {mergedDrinks.length > 0 && (
        <section className="mb-6 max-w-5xl rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-1 text-lg font-semibold">Per drink</h2>
          <p className="mb-4 text-sm text-gray-500">
            Member charges + SumUp card sales per drink (SumUp records the drink on each card
            payment). {sumup.state === "loading" && <span className="text-amber-400">Loading card sales…</span>}
            {sumup.state === "unavailable" && <span className="text-gray-500">Card sales unavailable.</span>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2">Drink</th>
                  <th className="py-2 text-right">Member</th>
                  <th className="py-2 text-right">Card</th>
                  <th className="py-2 text-right">Sold</th>
                  <th className="py-2 text-right">Revenue</th>
                  <th className="py-2 text-right">Discount</th>
                </tr>
              </thead>
              <tbody>
                {mergedDrinks.map((d) => (
                  <tr key={d.name} className="border-b border-gray-800/60">
                    <td className="py-2">{d.name}</td>
                    <td className="py-2 text-right tabular-nums text-gray-400">
                      {d.memberQty > 0 ? `${d.memberQty}× · ${euro(d.memberRev)}` : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-400">
                      {d.cardQty > 0 ? `${d.cardQty}× · ${euro(d.cardRev)}` : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{d.memberQty + d.cardQty}×</td>
                    <td className="py-2 text-right font-medium tabular-nums">{euro(d.memberRev + d.cardRev)}</td>
                    <td className="py-2 text-right tabular-nums text-gray-400">{d.discount > 0 ? euro(d.discount) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Drink specials ────────────────────────────────────────────────── */}
      <section className="max-w-5xl rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Drink specials</h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              activity.discountsActive ? "bg-green-500/15 text-green-400" : "bg-gray-700/40 text-gray-400"
            }`}
          >
            {activity.discountsActive ? "Active" : "Paused (in POS)"}
          </span>
        </div>
        <p className="mb-5 text-sm text-gray-500">
          Set a special price for a drink during this borrel (e.g. Flügel €1.00 on Flügel Friday).
          Bartenders can pause all specials from the POS when they run out.
        </p>

        <form onSubmit={addSpecial} className="mb-5 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400">Drink</span>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-52 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Select a drink…</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({euro(p.price)})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400">Special price €</span>
            <input
              type="number" min={0} step={0.05} value={price}
              onChange={(e) => setPrice(e.target.value)} placeholder="0.00"
              className="w-28 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !productId || price.trim() === ""}
            className="rounded-xl bg-amber-600 px-5 py-2 font-semibold transition-colors hover:bg-amber-500 disabled:opacity-40"
          >
            {busy ? "Adding…" : "Add special"}
          </button>
        </form>
        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {activity.discounts.length === 0 ? (
          <p className="text-sm text-gray-500">No specials yet for this borrel.</p>
        ) : (
          <ul className="space-y-2">
            {activity.discounts.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-4 rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-3">
                <span className="font-medium">{d.product.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm">
                    <span className="text-gray-500 line-through">{euro(d.product.price)}</span>{" "}
                    <span className="font-semibold text-amber-400">{euro(d.priceCents)}</span>
                  </span>
                  <button
                    onClick={() => removeSpecial(d)}
                    className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-400 hover:bg-red-600 hover:text-white"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: "green" | "red" }) {
  const border =
    accent === "green" ? "border-green-700/50 bg-green-900/20" : accent === "red" ? "border-red-700/50 bg-red-900/20" : "border-gray-800 bg-gray-950/40";
  return (
    <div className={`rounded-2xl border p-4 ${border}`}>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-600">{hint}</p>}
    </div>
  );
}
