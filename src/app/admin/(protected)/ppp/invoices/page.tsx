"use client";

import NeedsCheck from "../../NeedsCheck";
import { useEffect, useMemo, useState } from "react";

interface Line {
  id: string;
  quantity: number;
  unitCents: number;
  listCents: number | null; // normal price at sale time (null on old orders)
  specialCents: number | null; // borrel special that applied
  bartenderFree: boolean;
  product: { name: string; price: number };
}
interface Invoice {
  id: string;
  status: string;
  totalCents: number;
  confirmedAt: string;
  congressusInvoiceId: number | null;
  memberId: string;
  member: { firstName: string; lastName: string; email: string };
  activity: { name: string };
  lines: Line[];
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;

// The line's normal (undiscounted) unit price and why it was discounted, if it was.
function lineDiscount(l: Line): { listCents: number; reason: string | null } {
  const listCents = l.listCents ?? l.product.price;
  if (l.unitCents >= listCents) return { listCents, reason: null };
  if (l.bartenderFree) return { listCents, reason: "bartender free drink" };
  const special = l.specialCents != null;
  const role = l.unitCents < (l.specialCents ?? listCents);
  return {
    listCents,
    reason: special && role ? "special + role discount" : special ? "borrel special" : "role discount",
  };
}

interface LineDraft {
  quantity: number;
  removeDiscount: boolean;
}

export default function PppInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<"CONFIRMED" | "EXPORTED">("CONFIRMED");
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [checkKey, setCheckKey] = useState(0); // refreshes the "needs check" panel
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, LineDraft>>({});

  function load() {
    fetch(`/api/admin/ppp/invoices?status=${filter}`)
      .then((r) => r.json())
      .then((d) => setInvoices(d.invoices ?? []));
  }
  useEffect(load, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runExport() {
    setExporting(true);
    setResult(null);
    const res = await fetch("/api/admin/invoices/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "ppp" }),
    });
    const data = await res.json();
    const errorDetail = data.errors?.length ? `\nErrors:\n${data.errors.join("\n")}` : "";
    setResult(
      `Created ${data.ppp?.congressusInvoices ?? 0} PPP Congressus invoice(s) covering ${data.ppp?.exported ?? 0} order(s).` +
        (data.ppp?.failed ? ` ${data.ppp.failed} failed.${errorDetail}` : "")
    );
    if (data.needsCheck) {
      setResult(
        (r) => `${r}\n⚠️ ${data.needsCheck} order(s) need a check in Congressus — see the warning above.`
      );
    }
    setExporting(false);
    setCheckKey((k) => k + 1);
    load();
  }

  async function deleteInvoice(inv: Invoice) {
    if (!confirm(`Delete this order for ${inv.member.firstName} ${inv.member.lastName} (${euro(inv.totalCents)})?`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/ppp/invoices/${inv.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) setInvoices((prev) => prev.filter((x) => x.id !== inv.id));
    else alert((await res.json()).error ?? "Could not delete.");
  }

  function startEdit(inv: Invoice) {
    setEditId(inv.id);
    setDraft(Object.fromEntries(inv.lines.map((l) => [l.id, { quantity: l.quantity, removeDiscount: false }])));
  }
  const patchLine = (lineId: string, patch: Partial<LineDraft>) =>
    setDraft((d) => ({ ...d, [lineId]: { ...d[lineId], ...patch } }));

  // Unit price a line will have after the draft (list price when its discount is removed).
  const draftUnit = (l: Line) => (draft[l.id]?.removeDiscount ? lineDiscount(l).listCents : l.unitCents);
  const draftTotal = (inv: Invoice) =>
    inv.lines.reduce((s, l) => s + (draft[l.id]?.quantity ?? l.quantity) * draftUnit(l), 0);

  async function saveEdit(inv: Invoice) {
    const lines = inv.lines.map((l) => ({
      id: l.id,
      quantity: draft[l.id]?.quantity ?? l.quantity,
      removeDiscount: draft[l.id]?.removeDiscount ?? false,
    }));
    if (lines.every((l) => l.quantity <= 0) && !confirm("All lines are removed — delete this order?")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/ppp/invoices/${inv.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return alert(d.error ?? "Could not save changes.");
    setEditId(null);
    setResult(
      d.deleted
        ? `Deleted the order for ${inv.member.firstName} ${inv.member.lastName} (no lines left).`
        : `Updated the order for ${inv.member.firstName} ${inv.member.lastName}: ${euro(inv.totalCents)} → ${euro(d.totalCents)}.`
    );
    load();
  }

  async function clearAll() {
    const label = filter === "EXPORTED" ? "exported" : "pending (confirmed)";
    if (!confirm(`Delete ALL ${invoices.length} ${label} PPP order(s)? Permanent.`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/ppp/invoices?status=${filter}`, { method: "DELETE" });
    const d = await res.json();
    setBusy(false);
    if (res.ok) {
      setInvoices([]);
      setResult(`Deleted ${d.deleted} ${label} order(s).`);
    } else alert(d.error ?? "Could not clear.");
  }

  // Group orders by activity (borrel) for a clearer overview.
  const byActivity = useMemo(() => {
    const m = new Map<string, { name: string; total: number; invoices: Invoice[] }>();
    for (const inv of invoices) {
      const key = inv.activity.name;
      if (!m.has(key)) m.set(key, { name: key, total: 0, invoices: [] });
      const g = m.get(key)!;
      g.invoices.push(inv);
      g.total += inv.totalCents;
    }
    return [...m.values()];
  }, [invoices]);

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">PPP invoices</h1>
          <p className="text-gray-500">Borrel drink orders · {invoices.length} {filter.toLowerCase()}</p>
        </div>
        <button
          onClick={runExport}
          disabled={exporting}
          className="rounded-xl bg-green-600 px-5 py-2.5 font-semibold transition-colors hover:bg-green-500 disabled:opacity-40"
        >
          {exporting ? "Exporting…" : "Export PPP to Congressus"}
        </button>
      </div>

      {result && (
        <pre className={`mb-4 whitespace-pre-wrap rounded-lg p-3 text-sm ${result.includes("failed") || result.includes("Errors") ? "bg-red-900/40 text-red-300" : "bg-green-900/40 text-green-300"}`}>
          {result}
        </pre>
      )}

      <NeedsCheck system="ppp" refreshKey={checkKey} onResolved={load} />

      <div className="mb-6 flex items-center gap-2">
        {(["CONFIRMED", "EXPORTED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${filter === s ? "bg-white text-gray-900" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
          >
            {s === "CONFIRMED" ? "Pending export" : "Exported"}
          </button>
        ))}
        {invoices.length > 0 && (
          <button
            onClick={clearAll}
            disabled={busy}
            className="ml-auto rounded-lg border border-red-900 bg-red-900/30 px-4 py-1.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-40"
          >
            Clear all {filter === "EXPORTED" ? "exported" : "pending"} (test data)
          </button>
        )}
      </div>

      {invoices.length === 0 ? (
        <p className="text-gray-500">No {filter.toLowerCase()} PPP orders.</p>
      ) : (
        <div className="space-y-6">
          {byActivity.map((group) => (
            <section key={group.name}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">{group.name}</h2>
                <span className="text-sm text-gray-500">
                  {group.invoices.length} order{group.invoices.length === 1 ? "" : "s"} · {euro(group.total)}
                </span>
              </div>
              <div className="space-y-2">
                {group.invoices.map((inv) => (
                  <div key={inv.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <a href={`/admin/members/${inv.memberId}`} className="font-semibold hover:text-blue-400 hover:underline">
                          {inv.member.firstName} {inv.member.lastName}
                        </a>
                        <p className="truncate text-sm text-gray-400">{inv.member.email}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {inv.confirmedAt ? new Date(inv.confirmedAt).toLocaleString() : "—"}
                          {inv.congressusInvoiceId && ` · Congressus #${inv.congressusInvoiceId}`}
                        </p>
                      </div>
                      <p className="flex-shrink-0 text-2xl font-bold tabular-nums">{euro(inv.totalCents)}</p>
                    </div>
                    {editId === inv.id ? (
                      <div className="mt-4 space-y-2 border-t border-gray-800 pt-4">
                        {inv.lines.map((l) => {
                          const d = draft[l.id] ?? { quantity: l.quantity, removeDiscount: false };
                          const { listCents, reason } = lineDiscount(l);
                          const unit = draftUnit(l);
                          return (
                            <div key={l.id} className={`flex flex-wrap items-center gap-3 ${d.quantity === 0 ? "opacity-40" : ""}`}>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{l.product.name}</span>
                                {reason && (
                                  <span className={`text-xs ${d.removeDiscount ? "text-gray-500 line-through" : "text-amber-400"}`}>
                                    {reason}
                                  </span>
                                )}
                              </span>
                              <span className="text-sm text-gray-500">
                                {unit < listCents && <span className="mr-1 line-through">{euro(listCents)}</span>}
                                {euro(unit)} each
                              </span>
                              {reason && (
                                <button
                                  onClick={() => patchLine(l.id, { removeDiscount: !d.removeDiscount })}
                                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                                    d.removeDiscount
                                      ? "bg-amber-600 text-white hover:bg-amber-500"
                                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                                  }`}
                                  title="Charge this line at the drink's normal list price"
                                >
                                  {d.removeDiscount ? "↶ Keep discount" : "Remove discount"}
                                </button>
                              )}
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => patchLine(l.id, { quantity: Math.max(0, d.quantity - 1) })}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-800 text-xl hover:bg-red-600"
                                >
                                  −
                                </button>
                                <span className="w-8 text-center font-bold tabular-nums">{d.quantity}</span>
                                <button
                                  onClick={() => patchLine(l.id, { quantity: d.quantity + 1 })}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-800 text-xl hover:bg-green-600"
                                >
                                  +
                                </button>
                              </div>
                              <span className="w-20 text-right font-medium tabular-nums">{euro(d.quantity * unit)}</span>
                            </div>
                          );
                        })}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                          <span className="text-sm text-gray-400">
                            New total <b className="text-white tabular-nums">{euro(draftTotal(inv))}</b>
                            {draftTotal(inv) !== inv.totalCents && (
                              <span className="ml-1 text-gray-500">(was {euro(inv.totalCents)})</span>
                            )}
                          </span>
                          <div className="flex gap-2">
                            <button onClick={() => setEditId(null)} className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-white">
                              Cancel
                            </button>
                            <button
                              onClick={() => saveEdit(inv)}
                              disabled={busy}
                              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
                            >
                              Save changes
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center justify-between gap-4">
                        <p className="min-w-0 truncate text-sm text-gray-400">
                          {inv.lines.map((l) => `${l.quantity}× ${l.product.name}`).join(", ")}
                        </p>
                        {inv.status === "CONFIRMED" && (
                          <div className="flex flex-shrink-0 gap-2">
                            <button
                              onClick={() => startEdit(inv)}
                              className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-700"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteInvoice(inv)}
                              disabled={busy}
                              className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-600 hover:text-white disabled:opacity-40"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
