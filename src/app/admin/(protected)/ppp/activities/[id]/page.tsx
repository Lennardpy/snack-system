"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface ProductLite { id: string; name: string; price: number; specialPrice: number | null }
interface Discount { id: string; productId: string; priceCents: number; product: ProductLite }
interface Activity {
  id: string;
  name: string;
  status: "OPEN" | "CLOSED";
  discountsActive: boolean;
  discounts: Discount[];
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const toCents = (s: string) => Math.max(0, Math.round(Number(s) * 100));

export default function ActivityDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [discount, setDiscount] = useState({ specials: 0, total: 0, orders: 0 });
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
      setDiscount({
        specials: d.specialsDiscountCents ?? 0,
        total: d.totalDiscountCents ?? 0,
        orders: d.orderCount ?? 0,
      });
    }
    setLoading(false);
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  // Drinks not already on special.
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

      {/* Budget / discount given this borrel */}
      <div className="mb-6 grid max-w-2xl grid-cols-3 gap-3">
        <Stat label="Orders" value={String(discount.orders)} />
        <Stat label="Specials discount" value={euro(discount.specials)} hint="drink specials only" />
        <Stat label="Total discount given" value={euro(discount.total)} hint="incl. roles / free drinks" accent />
      </div>

      <section className="max-w-2xl rounded-2xl border border-gray-800 bg-gray-900 p-6">
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

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "border-amber-700/40 bg-amber-900/15" : "border-gray-800 bg-gray-900"}`}>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-gray-600">{hint}</p>}
    </div>
  );
}
