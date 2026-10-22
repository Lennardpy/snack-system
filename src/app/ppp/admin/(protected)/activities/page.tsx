"use client";

import { useEffect, useRef, useState } from "react";

interface Activity {
  id: string;
  name: string;
  status: "OPEN" | "CLOSED";
  date: string;
  associationId: "stress" | "dimensie"; // the host
  joint: boolean; // Stress + Dimensie (the weekly Thursday drink)
  readOnly: boolean; // Dimensie viewing a joint borrel Stress hosts
  orderCount: number;
  revenueCents: number;
  externalCents: number; // external-card tabs at internal prices (revenue, in the P/L)
  abProfitCents: number; // their price level's markup — AB profit, not in the P/L
  specialsDiscountCents: number;
  totalDiscountCents: number;
  cogsInclCents: number;
  sumupCents: number | null; // saved SumUp card revenue, null = not saved yet
}

interface OrderLine {
  quantity: number;
  unitCents: number;
  product: { name: string };
}
interface Tapper {
  email: string;
  member: { firstName: string; lastName: string } | null;
}
interface Order {
  id: string;
  totalCents: number;
  confirmedAt: string;
  member: { firstName: string; lastName: string };
  createdBy: Tapper | null;
  lines: OrderLine[];
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;

// Friendly name for the bartender who rang an order up: linked member name, else
// the part before the @ of their login email.
function tapperName(t: Tapper | null): string | null {
  if (!t) return null;
  if (t.member) return `${t.member.firstName} ${t.member.lastName}`.trim();
  return t.email.split("@")[0];
}

export default function AdminActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // SumUp card revenue fetched on this page for borrels not saved yet (the fetch
  // saves past ones, so next time they come with the list).
  const [sumupFetched, setSumupFetched] = useState<Record<string, number | "loading" | "n/a">>({});
  const sumupRequested = useRef(new Set<string>());

  async function load() {
    // Import any newly-scheduled Stress borrels from Alexia first, so they appear
    // here for the admin to pre-set specials on (fail-soft).
    const sync = await fetch("/api/ppp/alexia/sync", { method: "POST" })
      .then((r) => (r.ok ? r.json() : { imported: 0 }))
      .catch(() => ({ imported: 0 }));
    if (sync.imported > 0) {
      setNotice(`Imported ${sync.imported} new borrel${sync.imported === 1 ? "" : "s"} from Alexia.`);
    }
    const res = await fetch("/api/admin/ppp/activities");
    if (res.ok) {
      const list: Activity[] = (await res.json()).activities;
      setActivities(list);
      fetchMissingSumup(list);
    }
    setLoading(false);
  }

  // One at a time: an unsaved borrel fans out into per-transaction SumUp requests.
  async function fetchMissingSumup(list: Activity[]) {
    const now = Date.now();
    // SumUp is Stress's account: only Stress borrels (and not for Dimensie's view of a joint one).
    const todo = list.filter(
      (a) =>
        a.sumupCents == null &&
        a.associationId === "stress" &&
        !a.readOnly &&
        new Date(a.date).getTime() <= now &&
        !sumupRequested.current.has(a.id)
    );
    for (const a of todo) {
      sumupRequested.current.add(a.id);
      setSumupFetched((m) => ({ ...m, [a.id]: "loading" }));
      const d = await fetch(`/api/admin/ppp/activities/${a.id}/sumup`)
        .then((r) => (r.ok ? r.json() : { available: false }))
        .catch(() => ({ available: false }));
      setSumupFetched((m) => ({ ...m, [a.id]: d.available ? d.revenueCents : "n/a" }));
    }
  }

  // SumUp card revenue for a row: saved, fetched here, still loading, or unknown.
  function sumupFor(a: Activity): number | "loading" | "n/a" | null {
    if (a.sumupCents != null) return a.sumupCents;
    return sumupFetched[a.id] ?? (new Date(a.date).getTime() > Date.now() ? null : "loading");
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

  // Closing a borrel surfaces the discount given (budget spent on specials + total).
  async function closeActivity(a: Activity) {
    setActingId(a.id);
    const res = await fetch(`/api/ppp/activities/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CLOSED" }),
    });
    setActingId(null);
    if (res.ok) {
      setNotice(
        `Closed "${a.name}". Specials discount: ${euro(a.specialsDiscountCents)} · ` +
          `Total discount given: ${euro(a.totalDiscountCents)}.`
      );
      load();
    } else {
      alert((await res.json()).error ?? "Could not close");
    }
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

  // Only activities without PPP orders can be deleted (e.g. external activities or
  // free drinks synced from Alexia); they won't be re-imported.
  async function remove(a: Activity) {
    if (!confirm(`Delete "${a.name}"?\n\nIt won't be re-imported from Alexia. Its specials and usage are removed too.`)) return;
    setActingId(a.id);
    const res = await fetch(`/api/admin/ppp/activities/${a.id}`, { method: "DELETE" });
    setActingId(null);
    if (res.ok) {
      setActivities((prev) => prev.filter((x) => x.id !== a.id));
      setNotice(`Deleted "${a.name}".`);
    } else {
      alert((await res.json().catch(() => ({}))).error ?? "Could not delete");
    }
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
      {notice && (
        <p className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-amber-900/30 px-4 py-2 text-sm text-amber-200">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-amber-400/70 hover:text-amber-200">✕</button>
        </p>
      )}

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
                    {a.joint && (
                      <span className="rounded-full bg-teal-500/15 px-2 py-0.5 text-xs font-medium text-teal-300">
                        Joint · Stress &amp; Dimensie
                      </span>
                    )}
                    {a.associationId === "dimensie" && (
                      <span className="rounded-full bg-teal-900/60 px-2 py-0.5 text-xs font-medium text-teal-300">Dimensie</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(a.date).toLocaleDateString()} · {a.orderCount} order{a.orderCount === 1 ? "" : "s"}
                  </p>
                  {(() => {
                    const card = sumupFor(a);
                    const cardCents = typeof card === "number" ? card : 0;
                    const totalRevenue = a.revenueCents + a.externalCents + cardCents;
                    const net = totalRevenue - a.cogsInclCents;
                    const settled = card !== "loading";
                    return (
                      <>
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                          <span className="text-xl font-bold tabular-nums">
                            {euro(totalRevenue)} <span className="text-xs font-normal text-gray-500">revenue</span>
                          </span>
                          {a.cogsInclCents > 0 && (
                            <span className="text-xl font-bold tabular-nums text-white">
                              −{euro(a.cogsInclCents)}{" "}
                              <span className="text-xs font-normal text-gray-500">cost of goods</span>
                            </span>
                          )}
                          {a.cogsInclCents > 0 && settled && (
                            <span
                              className={`rounded-lg px-2.5 py-1 text-xl font-bold tabular-nums ${
                                net >= 0 ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                              }`}
                            >
                              {net >= 0 ? "▲ +" : "▼ −"}
                              {euro(Math.abs(net))}{" "}
                              <span className="text-xs font-medium opacity-80">{net >= 0 ? "profit" : "loss"}</span>
                            </span>
                          )}
                        </div>
                        {card !== null && (
                          <p className="mt-0.5 text-xs text-gray-500">
                            PPP {euro(a.revenueCents)}
                            {a.externalCents > 0 && <> · External {euro(a.externalCents)}</>} · SumUp{" "}
                            {card === "loading" ? "loading…" : card === "n/a" ? "unavailable" : euro(card)}
                            {a.abProfitCents > 0 && <> · AB profit {euro(a.abProfitCents)} (not in P/L)</>}
                          </p>
                        )}
                      </>
                    );
                  })()}
                  {a.totalDiscountCents > 0 && (
                    <p className="mt-1 text-xs text-gray-600">
                      Discount given · specials {euro(a.specialsDiscountCents)} · total{" "}
                      <span className="text-amber-400/80">{euro(a.totalDiscountCents)}</span>
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <a
                    href={`/ppp/admin/activities/${a.id}`}
                    className="rounded-lg bg-amber-600/90 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500"
                  >
                    📊 Details / P&amp;L
                  </a>
                  <button
                    onClick={() => toggleOrders(a)}
                    className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
                  >
                    {expanded === a.id ? "Hide orders" : "View orders"}
                  </button>
                  {a.readOnly ? (
                    <span className="text-xs text-gray-500" title="Stress hosts this borrel; you see your members' orders">
                      View only
                    </span>
                  ) : (
                  <>
                  <button
                    onClick={() => rename(a)}
                    disabled={actingId === a.id}
                    className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => (a.status === "OPEN" ? closeActivity(a) : patch(a.id, { status: "OPEN" }))}
                    disabled={actingId === a.id}
                    className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40 ${
                      a.status === "OPEN"
                        ? "bg-gray-800 text-gray-300 hover:bg-red-600 hover:text-white"
                        : "bg-green-600/80 text-white hover:bg-green-600"
                    }`}
                  >
                    {a.status === "OPEN" ? "Close" : "Reopen"}
                  </button>
                  <button
                    onClick={() => remove(a)}
                    disabled={actingId === a.id || a.orderCount > 0}
                    title={
                      a.orderCount > 0
                        ? "Can't delete — this activity has PPP orders"
                        : "Delete (e.g. an external activity or free drink)"
                    }
                    className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-gray-800 disabled:hover:text-gray-300"
                  >
                    Delete
                  </button>
                  </>
                  )}
                </div>
              </div>

              {expanded === a.id && (
                <div className="border-t border-gray-800 px-4 py-3">
                  {orders.length === 0 ? (
                    <p className="text-sm text-gray-600">No orders for this activity.</p>
                  ) : (
                    <ul className="space-y-2">
                      {orders.map((o) => {
                        const tapper = tapperName(o.createdBy);
                        return (
                          <li key={o.id} className="flex items-start justify-between gap-3 text-sm">
                            <div className="min-w-0">
                              <span className="font-medium">
                                {o.member.firstName} {o.member.lastName}
                              </span>
                              <span className="ml-2 text-gray-500">
                                {o.lines.map((l) => `${l.quantity}× ${l.product.name}`).join(", ")}
                              </span>
                              {tapper && (
                                <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                                  🍺 {tapper}
                                </span>
                              )}
                            </div>
                            <span className="flex-shrink-0 text-gray-400">{euro(o.totalCents)}</span>
                          </li>
                        );
                      })}
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
