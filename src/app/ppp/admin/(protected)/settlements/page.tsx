"use client";

import { useCallback, useEffect, useState } from "react";
import type { SettlementSnapshot } from "@/lib/settlement";
import { vatLabel, vatSummary } from "@/lib/vat";

// Stress's monthly invoices to Dimensie (src/lib/settlement.ts). The Stress side
// sees the live draft of a month and finalises it (freezing the figures and
// locking the orders); the treasurer downloads the PDF + CSV, books it and sends
// it to Dimensie, then marks it sent. Dimensie sees invoices once marked sent.

interface SettlementRow {
  id: string;
  number: string;
  month: string;
  status: "FINAL" | "SENT";
  totalInclCents: number;
  createdAt: string;
  sentAt: string | null;
  _count: { orders: number };
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 15)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};

export default function SettlementsPage() {
  const [month, setMonth] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [draft, setDraft] = useState<SettlementSnapshot | null>(null);
  const [open, setOpen] = useState<{ id: string; snapshot: SettlementSnapshot } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (m?: string) => {
    const res = await fetch(`/api/admin/ppp/settlements${m ? `?month=${m}` : ""}`);
    if (!res.ok) return;
    const d = await res.json();
    setMonth(d.month);
    setCanManage(d.canManage);
    setRows(d.settlements);
    setDraft(d.draft);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function finalize() {
    if (!month || !draft) return;
    if (
      !confirm(
        `Finalise ${draft.monthLabel}: ${euro(draft.breakdown.totalInclCents)} incl. VAT for ${draft.orders} order(s)?\n\n` +
          "The figures are frozen and these orders can no longer be changed. Orders added later go on next month's invoice."
      )
    )
      return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/ppp/settlements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month }),
    });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Could not finalise");
    load(month);
  }

  async function act(r: SettlementRow, method: "PATCH" | "DELETE") {
    const question =
      method === "PATCH"
        ? `Mark ${r.number} as sent to Dimensie (booked and sent by the treasurer)? Dimensie can see it from then on, and it can't be undone.`
        : `Undo ${r.number}? Its orders go back into the draft and can be changed again.`;
    if (!confirm(question)) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/ppp/settlements/${r.id}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "PATCH" ? JSON.stringify({ status: "SENT" }) : undefined,
    });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Could not save");
    if (open?.id === r.id) setOpen(null);
    load(month ?? undefined);
  }

  async function view(r: SettlementRow) {
    if (open?.id === r.id) return setOpen(null);
    const res = await fetch(`/api/admin/ppp/settlements/${r.id}`);
    if (res.ok) setOpen({ id: r.id, snapshot: (await res.json()).settlement.snapshot });
  }

  const thisMonthDone = rows.some((r) => r.month === month);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold">{canManage ? "Invoices to Dimensie" : "Invoices from Stress"}</h1>
      <p className="mb-6 max-w-3xl text-gray-500">
        What Dimensie members drank at joint borrels (Stress hosts and pays the bar), invoiced to Dimensie once a month —
        at the drink price before Dimensie&apos;s own member discounts, incl. VAT. Bartenders&apos; free drinks are
        Stress&apos;s. {canManage
          ? "The system doesn't make or send the invoice: the treasurer makes the invoice for Dimensie and attaches the specification (PDF: every purchase, per drink, per member, VAT per category) and/or the CSV, books it and sends it — then marks it sent here. Only then does Dimensie see it."
          : "Invoices appear here once Stress's treasurer has sent them."}
      </p>
      {error && <p className="mb-4 rounded-lg bg-red-900/30 px-4 py-2 text-sm text-red-300">{error}</p>}

      {canManage && month && (
        <section className="mb-8 max-w-5xl rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Draft</h2>
              <input
                type="month"
                value={month}
                onChange={(e) => e.target.value && load(e.target.value)}
                className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <button
              onClick={finalize}
              disabled={busy || !draft || draft.orders === 0 || thisMonthDone}
              title={thisMonthDone ? "This month already has an invoice" : undefined}
              className="rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-semibold hover:bg-amber-500 disabled:opacity-40"
            >
              {busy ? "Working…" : `Finalise ${monthLabel(month)}`}
            </button>
          </div>
          {draft && draft.orders > 0 ? (
            <Overview snap={draft} />
          ) : (
            <p className="text-sm text-gray-500">
              Nothing to invoice for {monthLabel(month)} (or earlier) — no unbilled orders of Dimensie members at Stress borrels.
            </p>
          )}
          {thisMonthDone && draft && draft.orders > 0 && (
            <p className="mt-3 text-sm text-amber-300">
              {monthLabel(month)} is already invoiced; these orders were added afterwards — they go on the next month&apos;s invoice.
            </p>
          )}
        </section>
      )}

      <h2 className="mb-3 text-lg font-semibold">{canManage ? "Finalised" : "Invoices"}</h2>
      {rows.length === 0 ? (
        <p className="text-gray-500">None yet.</p>
      ) : (
        <ul className="max-w-5xl space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-gray-800 bg-gray-900">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <button onClick={() => view(r)} className="min-w-0 text-left">
                  <p className="font-semibold">
                    {r.number} · {monthLabel(r.month)}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.status === "SENT" ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-300"
                      }`}
                    >
                      {r.status === "SENT" ? `Sent ${new Date(r.sentAt!).toLocaleDateString()}` : "Finalised"}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {r._count.orders} order(s) · {euro(r.totalInclCents)} incl. VAT · {open?.id === r.id ? "▴ hide" : "▾ details"}
                  </p>
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`/api/admin/ppp/settlements/${r.id}/pdf`} className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700">
                    ⬇ Specification (PDF)
                  </a>
                  <a href={`/api/admin/ppp/settlements/${r.id}/csv`} className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700">
                    ⬇ Purchases (CSV)
                  </a>
                  {canManage && r.status === "FINAL" && (
                    <>
                      <button onClick={() => act(r, "PATCH")} disabled={busy} className="rounded-lg bg-green-600/80 px-3 py-2 text-sm text-white hover:bg-green-600 disabled:opacity-40">
                        Mark sent to Dimensie
                      </button>
                      <button onClick={() => act(r, "DELETE")} disabled={busy} className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-400 hover:bg-red-600 hover:text-white disabled:opacity-40">
                        Undo
                      </button>
                    </>
                  )}
                </div>
              </div>
              {open?.id === r.id && (
                <div className="border-t border-gray-800 px-4 py-4">
                  <Overview snap={open.snapshot} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Totals, per drink, per member and per borrel of one invoice (draft or final).
function Overview({ snap }: { snap: SettlementSnapshot }) {
  const b = snap.breakdown;
  const [showMembers, setShowMembers] = useState(false);
  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <span>
          <span className="text-gray-500">Total incl. VAT </span>
          <b className="text-lg tabular-nums">{euro(b.totalInclCents)}</b>
        </span>
        <span className="text-gray-400">
          excl. {euro(b.totalExclCents)}
          {vatSummary(b).map((r) => (
            <span key={r.rate}>
              {" "}
              · {vatLabel(r.rate)}: {euro(r.vatCents)} VAT over {euro(r.exclCents)}
            </span>
          ))}
        </span>
        <span className="text-gray-500">
          {snap.orders} order(s) · {b.drinks} drink(s) · {snap.members.length} member(s) · charged to members{" "}
          {euro(snap.chargedToMembersCents)}
        </span>
      </div>

      <table className="w-full max-w-3xl">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="py-1.5">Drink</th>
            <th className="py-1.5 text-right">Qty</th>
            <th className="py-1.5 text-right">Unit incl.</th>
            <th className="py-1.5 text-right">VAT</th>
            <th className="py-1.5 text-right">Total excl.</th>
            <th className="py-1.5 text-right">Total incl.</th>
          </tr>
        </thead>
        <tbody>
          {b.lines.map((l) => (
            <tr key={`${l.productId}-${l.unitInclCents}-${l.vatRate}`} className="border-b border-gray-800/60">
              <td className="py-1.5">{l.name}</td>
              <td className="py-1.5 text-right tabular-nums">{l.quantity}</td>
              <td className="py-1.5 text-right tabular-nums">{euro(l.unitInclCents)}</td>
              <td className="py-1.5 text-right text-gray-500">{vatLabel(l.vatRate)}</td>
              <td className="py-1.5 text-right tabular-nums text-gray-400">{euro(l.totalExclCents)}</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{euro(l.totalInclCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div>
        <button onClick={() => setShowMembers((v) => !v)} className="text-amber-400 hover:underline">
          {showMembers ? "▴ Hide" : "▾ Show"} per member ({snap.members.length}) and per borrel ({snap.borrels.length})
        </button>
        {showMembers && (
          <div className="mt-3 grid gap-6 lg:grid-cols-2">
            <ul className="space-y-2">
              {snap.members.map((m) => (
                <li key={`${m.congressusId}-${m.name}`} className="rounded-lg bg-gray-950/50 px-3 py-2">
                  <p className="flex justify-between font-medium">
                    <span>{m.name}</span>
                    <span className="tabular-nums">{euro(m.totalInclCents)}</span>
                  </p>
                  {m.lines.map((l) => (
                    <p key={`${l.name}-${l.unitInclCents}`} className="flex justify-between text-xs text-gray-500">
                      <span>
                        {l.quantity}× {l.name} @ {euro(l.unitInclCents)}
                      </span>
                      <span className="tabular-nums">{euro(l.totalInclCents)}</span>
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            <ul className="space-y-1">
              {snap.borrels.map((bo) => (
                <li key={`${bo.name}-${bo.date}`} className="flex justify-between rounded-lg bg-gray-950/50 px-3 py-2">
                  <span>
                    {bo.name} <span className="text-xs text-gray-500">{new Date(bo.date).toLocaleDateString()}</span>
                  </span>
                  <span className="tabular-nums">
                    {bo.drinks}× · {euro(bo.totalInclCents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
