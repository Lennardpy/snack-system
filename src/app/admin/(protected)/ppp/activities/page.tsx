"use client";

import { useEffect, useState } from "react";

interface Activity {
  id: string;
  name: string;
  status: "OPEN" | "CLOSED";
  date: string;
  orderCount: number;
  revenueCents: number;
}

interface OrderLine {
  quantity: number;
  unitCents: number;
  product: { name: string };
}
interface Order {
  id: string;
  totalCents: number;
  confirmedAt: string;
  member: { firstName: string; lastName: string };
  lines: OrderLine[];
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;

export default function AdminActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/ppp/activities");
    if (res.ok) setActivities((await res.json()).activities);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/ppp/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      load();
    } else {
      setError((await res.json()).error ?? "Could not create activity");
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setActingId(id);
    const res = await fetch(`/api/ppp/activities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setActingId(null);
    if (res.ok) load();
    else alert((await res.json()).error ?? "Update failed");
  }

  async function toggleOrders(a: Activity) {
    if (expanded === a.id) {
      setExpanded(null);
      return;
    }
    setExpanded(a.id);
    setOrders([]);
    const res = await fetch(`/api/ppp/invoices?activityId=${a.id}`);
    if (res.ok) setOrders((await res.json()).invoices);
  }

  async function rename(a: Activity) {
    const next = prompt("Rename activity", a.name);
    if (next && next.trim() && next.trim() !== a.name) patch(a.id, { name: next.trim() });
  }

  return (
    <div className="p-8">
      <div className="mb-2">
        <h1 className="text-3xl font-bold">Activities</h1>
        <p className="text-gray-500">
          Borrels and events where drinks are sold. Close one to stop new orders; reopen any time.
        </p>
      </div>

      <form onSubmit={create} className="my-6 flex flex-wrap items-end gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New activity (e.g. Borrel 28 jun)"
          className="w-72 rounded-lg bg-gray-800 px-4 py-2.5 outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-xl bg-amber-600 px-5 py-2.5 font-semibold transition-colors hover:bg-amber-500 disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create activity"}
        </button>
      </form>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : activities.length === 0 ? (
        <p className="text-gray-500">No activities yet.</p>
      ) : (
        <ul className="max-w-3xl space-y-2">
          {activities.map((a) => (
            <li key={a.id} className="rounded-xl border border-gray-800 bg-gray-900">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold">
                    <span className="truncate">{a.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        a.status === "OPEN"
                          ? "bg-green-500/15 text-green-400"
                          : "bg-gray-700/40 text-gray-400"
                      }`}
                    >
                      {a.status === "OPEN" ? "Open" : "Closed"}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(a.date).toLocaleDateString()} · {a.orderCount} order
                    {a.orderCount === 1 ? "" : "s"} · {euro(a.revenueCents)}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    onClick={() => toggleOrders(a)}
                    className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
                  >
                    {expanded === a.id ? "Hide orders" : "View orders"}
                  </button>
                  <button
                    onClick={() => rename(a)}
                    disabled={actingId === a.id}
                    className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => patch(a.id, { status: a.status === "OPEN" ? "CLOSED" : "OPEN" })}
                    disabled={actingId === a.id}
                    className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40 ${
                      a.status === "OPEN"
                        ? "bg-gray-800 text-gray-300 hover:bg-red-600 hover:text-white"
                        : "bg-green-600/80 text-white hover:bg-green-600"
                    }`}
                  >
                    {a.status === "OPEN" ? "Close" : "Reopen"}
                  </button>
                </div>
              </div>

              {expanded === a.id && (
                <div className="border-t border-gray-800 px-4 py-3">
                  {orders.length === 0 ? (
                    <p className="text-sm text-gray-600">No orders for this activity.</p>
                  ) : (
                    <ul className="space-y-2">
                      {orders.map((o) => (
                        <li key={o.id} className="flex items-start justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <span className="font-medium">
                              {o.member.firstName} {o.member.lastName}
                            </span>
                            <span className="ml-2 text-gray-500">
                              {o.lines.map((l) => `${l.quantity}× ${l.product.name}`).join(", ")}
                            </span>
                          </div>
                          <span className="flex-shrink-0 text-gray-400">{euro(o.totalCents)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
