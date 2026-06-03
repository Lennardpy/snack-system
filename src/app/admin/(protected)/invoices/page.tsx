"use client";

import { useEffect, useState } from "react";

interface Invoice {
  id: string;
  status: string;
  totalCents: number;
  confirmedAt: string;
  member: { firstName: string; lastName: string; email: string };
  lines: { quantity: number; unitCents: number; product: { name: string } }[];
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<"CONFIRMED" | "EXPORTED">("CONFIRMED");
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/invoices?status=${filter}`)
      .then((r) => r.json())
      .then((d) => setInvoices(d.invoices ?? []));
  }, [filter]);

  async function runExport() {
    setExporting(true);
    setResult(null);
    const res = await fetch("/api/admin/invoices/export", { method: "POST" });
    const data = await res.json();
    setResult(`Exported ${data.exported} invoice(s). ${data.failed ? `${data.failed} failed.` : ""}`);
    setExporting(false);
    // Refresh list
    fetch(`/api/admin/invoices?status=${filter}`)
      .then((r) => r.json())
      .then((d) => setInvoices(d.invoices ?? []));
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Invoices</h1>
        <button
          onClick={runExport}
          disabled={exporting}
          className="bg-green-600 hover:bg-green-500 disabled:opacity-40 px-5 py-2 rounded-lg font-semibold"
        >
          {exporting ? "Exporting…" : "Export to Congressus"}
        </button>
      </div>

      {result && <p className="mb-4 text-green-400">{result}</p>}

      <div className="flex gap-2 mb-6">
        {(["CONFIRMED", "EXPORTED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium ${filter === s ? "bg-white text-gray-900" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {invoices.map((inv) => (
          <div key={inv.id} className="bg-gray-800 rounded-xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold">{inv.member.firstName} {inv.member.lastName}</p>
                <p className="text-gray-400 text-sm">{inv.member.email}</p>
                <p className="text-gray-500 text-xs mt-1">
                  {new Date(inv.confirmedAt).toLocaleString()}
                </p>
              </div>
              <p className="text-xl font-bold">€{(inv.totalCents / 100).toFixed(2)}</p>
            </div>
            <p className="text-gray-400 text-sm mt-2">
              {inv.lines.map((l) => `${l.quantity}× ${l.product.name}`).join(", ")}
            </p>
          </div>
        ))}
        {invoices.length === 0 && (
          <p className="text-gray-500">No {filter.toLowerCase()} invoices.</p>
        )}
      </div>
    </main>
  );
}
