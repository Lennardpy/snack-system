"use client";

import { useEffect, useState } from "react";
import { ASSOCIATION_LABEL, type AssociationId } from "@/lib/associations";

// A member's invoices with a PDF per invoice (src/lib/member-invoice.ts) — on the
// admin member page (to explain an invoice to the member) and in the member portal.

export interface InvoiceRow {
  key: string;
  association: AssociationId;
  reference: string;
  period: string;
  date: string;
  totalCents: number;
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;

export default function MemberInvoiceList({
  listUrl,
  pdfUrl,
  rows: given,
  showAssociation = false,
}: {
  listUrl?: string;
  pdfUrl: (key: string) => string;
  rows?: InvoiceRow[];
  showAssociation?: boolean;
}) {
  const [fetched, setFetched] = useState<InvoiceRow[] | null>(null);
  useEffect(() => {
    if (!listUrl) return;
    fetch(listUrl)
      .then((r) => (r.ok ? r.json() : { invoices: [] }))
      .then((d) => setFetched(d.invoices));
  }, [listUrl]);
  const rows = given ?? fetched;

  if (!rows) return <p className="text-sm text-gray-500">Loading…</p>;
  if (rows.length === 0) return <p className="text-gray-500">No invoices yet.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-3 rounded-xl bg-gray-800/60 px-4 py-3">
          <div className="min-w-0">
            <p className="font-semibold">
              {r.period} · <span className="tabular-nums">{euro(r.totalCents)}</span>
            </p>
            <p className="truncate text-xs text-gray-500">
              {showAssociation && `${ASSOCIATION_LABEL[r.association]} · `}
              {r.reference} · {new Date(r.date).toLocaleDateString("en-GB")}
            </p>
          </div>
          <a
            href={pdfUrl(r.key)}
            className="flex-shrink-0 rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700"
          >
            ⬇ PDF
          </a>
        </li>
      ))}
    </ul>
  );
}
