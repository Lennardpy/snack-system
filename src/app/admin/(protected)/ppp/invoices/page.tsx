"use client";

import { useEffect, useMemo, useState } from "react";

interface Line {
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
  activity: { name: string };
  lines: Line[];
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;

export default function PppInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<"CONFIRMED" | "EXPORTED">("CONFIRMED");
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setExporting(false);
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
                        <p className="font-semibold">{inv.member.firstName} {inv.member.lastName}</p>
                        <p className="truncate text-sm text-gray-400">{inv.member.email}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {inv.confirmedAt ? new Date(inv.confirmedAt).toLocaleString() : "—"}
                          {inv.congressusInvoiceId && ` · Congressus #${inv.congressusInvoiceId}`}
                        </p>
                      </div>
                      <p className="flex-shrink-0 text-2xl font-bold tabular-nums">{euro(inv.totalCents)}</p>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-4">
                      <p className="min-w-0 truncate text-sm text-gray-400">
                        {inv.lines.map((l) => `${l.quantity}× ${l.product.name}`).join(", ")}
                      </p>
                      {inv.status === "CONFIRMED" && (
                        <button
                          onClick={() => deleteInvoice(inv)}
                          disabled={busy}
                          className="flex-shrink-0 rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-600 hover:text-white disabled:opacity-40"
                        >
                          Delete
                        </button>
                      )}
                    </div>
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
