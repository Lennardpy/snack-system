"use client";

import { useEffect, useState } from "react";

interface Line {
  id: string;
  quantity: number;
  unitCents: number;
  product: { name: string };
}
interface Invoice {
  id: string;
  status: string;
  totalCents: number;
  confirmedAt: string;
  congressusInvoiceId: number | null;
  member: { firstName: string; lastName: string; email: string };
  lines: Line[];
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<"CONFIRMED" | "EXPORTED">("CONFIRMED");
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draftQty, setDraftQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  function load() {
    fetch(`/api/admin/invoices?status=${filter}`)
      .then((r) => r.json())
      .then((d) => setInvoices(d.invoices ?? []));
  }

  useEffect(load, [filter]);

  async function runExport() {
    setExporting(true);
    setResult(null);
    const res = await fetch("/api/admin/invoices/export", { method: "POST" });
    const data = await res.json();
    const errorDetail = data.errors?.length ? `\nErrors:\n${data.errors.join("\n")}` : "";
    setResult(
      `Created ${data.congressusInvoices ?? 0} Congressus invoice(s) covering ${data.exported} purchase(s).` +
      (data.failed ? ` ${data.failed} failed.${errorDetail}` : "")
    );
    setExporting(false);
    load();
  }

  function startEdit(inv: Invoice) {
    setEditId(inv.id);
    setDraftQty(Object.fromEntries(inv.lines.map((l) => [l.id, l.quantity])));
  }

  function setQty(lineId: string, q: number) {
    setDraftQty((prev) => ({ ...prev, [lineId]: Math.max(0, q) }));
  }

  async function saveEdit(inv: Invoice) {
    setBusy(true);
    const lines = inv.lines.map((l) => ({ id: l.id, quantity: draftQty[l.id] ?? l.quantity }));
    const res = await fetch(`/api/admin/invoices/${inv.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    });
    setBusy(false);
    if (res.ok) {
      setEditId(null);
      load();
    } else {
      const d = await res.json();
      alert(d.error ?? "Could not save changes.");
    }
  }

  async function deleteInvoice(inv: Invoice) {
    if (!confirm(`Delete this invoice for ${inv.member.firstName} ${inv.member.lastName} (${euro(inv.totalCents)})?`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/invoices/${inv.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setInvoices((prev) => prev.filter((x) => x.id !== inv.id));
    } else {
      const d = await res.json();
      alert(d.error ?? "Could not delete invoice.");
    }
  }

  const draftTotal = (inv: Invoice) =>
    inv.lines.reduce((s, l) => s + (draftQty[l.id] ?? l.quantity) * l.unitCents, 0);

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Invoices</h1>
          <p className="text-gray-500">{invoices.length} {filter.toLowerCase()}</p>
        </div>
        <button
          onClick={runExport}
          disabled={exporting}
          className="rounded-xl bg-green-600 px-5 py-2.5 font-semibold transition-colors hover:bg-green-500 disabled:opacity-40"
        >
          {exporting ? "Exporting…" : "Export to Congressus"}
        </button>
      </div>

      {result && (
        <pre className={`mb-4 whitespace-pre-wrap rounded-lg p-3 text-sm ${result.includes("failed") || result.includes("Errors") ? "bg-red-900/40 text-red-300" : "bg-green-900/40 text-green-300"}`}>
          {result}
        </pre>
      )}

      <div className="mb-6 flex gap-2">
        {(["CONFIRMED", "EXPORTED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setFilter(s); setEditId(null); }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${filter === s ? "bg-white text-gray-900" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
          >
            {s === "CONFIRMED" ? "Pending export" : "Exported"}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {invoices.map((inv) => {
          const editing = editId === inv.id;
          return (
            <div key={inv.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold">{inv.member.firstName} {inv.member.lastName}</p>
                  <p className="truncate text-sm text-gray-400">{inv.member.email}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {inv.confirmedAt ? new Date(inv.confirmedAt).toLocaleString() : "—"}
                    {inv.congressusInvoiceId && ` · Congressus #${inv.congressusInvoiceId}`}
                  </p>
                </div>
                <p className="flex-shrink-0 text-2xl font-bold tabular-nums">
                  {euro(editing ? draftTotal(inv) : inv.totalCents)}
                </p>
              </div>

              {/* Lines */}
              {editing ? (
                <div className="mt-4 space-y-2 border-t border-gray-800 pt-4">
                  {inv.lines.map((l) => {
                    const q = draftQty[l.id] ?? l.quantity;
                    return (
                      <div key={l.id} className={`flex items-center gap-3 ${q === 0 ? "opacity-40" : ""}`}>
                        <span className="min-w-0 flex-1 truncate">{l.product.name}</span>
                        <span className="text-sm text-gray-500">{euro(l.unitCents)} each</span>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setQty(l.id, q - 1)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-800 text-xl hover:bg-red-600">−</button>
                          <span className="w-8 text-center font-bold tabular-nums">{q}</span>
                          <button onClick={() => setQty(l.id, q + 1)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-800 text-xl hover:bg-green-600">+</button>
                        </div>
                        <span className="w-20 text-right font-medium tabular-nums">{euro(q * l.unitCents)}</span>
                      </div>
                    );
                  })}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <button
                      onClick={() => deleteInvoice(inv)}
                      disabled={busy}
                      className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-40"
                    >
                      Delete invoice
                    </button>
                    <div className="flex gap-2">
                      <button onClick={() => setEditId(null)}
                        className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-white">
                        Cancel
                      </button>
                      <button onClick={() => saveEdit(inv)} disabled={busy}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40">
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
                    <button
                      onClick={() => startEdit(inv)}
                      className="flex-shrink-0 rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-700"
                    >
                      Edit
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {invoices.length === 0 && <p className="text-gray-500">No {filter.toLowerCase()} invoices.</p>}
      </div>
    </div>
  );
}
