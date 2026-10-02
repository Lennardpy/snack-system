"use client";

import { useCallback, useEffect, useState } from "react";

// Orders left in EXPORTING after an export whose outcome was unknown (timeout,
// Congressus error, crash). Shown as a warning on the invoices pages so the admin
// checks Congressus and resolves them — never exported twice, never forgotten.

interface StuckInvoice {
  id: string;
  memberId: string;
  totalCents: number;
  confirmedAt: string | null;
  exportClaim: string | null;
  exportClaimedAt: string | null;
  member: { firstName: string; lastName: string };
}
interface Group {
  key: string;
  name: string;
  ids: string[];
  totalCents: number;
  claimedAt: Date | null;
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const MIN_CLAIM_AGE_MS = 10 * 60 * 1000;

export default function NeedsCheck({
  system,
  refreshKey,
  onResolved,
}: {
  system: "sss" | "ppp";
  refreshKey: number;
  onResolved: () => void;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const base = system === "ppp" ? "/api/admin/ppp/invoices" : "/api/admin/invoices";

  const load = useCallback(async () => {
    const res = await fetch(`${base}?status=EXPORTING`);
    if (!res.ok) return;
    const invoices: StuckInvoice[] = (await res.json()).invoices ?? [];
    // One group per export run × member = one (possible) Congressus invoice.
    const m = new Map<string, Group>();
    for (const inv of invoices) {
      const key = `${inv.exportClaim}-${inv.memberId}`;
      const g = m.get(key) ?? {
        key,
        name: `${inv.member.firstName} ${inv.member.lastName}`,
        ids: [],
        totalCents: 0,
        claimedAt: inv.exportClaimedAt ? new Date(inv.exportClaimedAt) : null,
      };
      g.ids.push(inv.id);
      g.totalCents += inv.totalCents;
      m.set(key, g);
    }
    setGroups([...m.values()]);
  }, [base]);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function resolve(g: Group, action: "exported" | "pending") {
    let congressusInvoiceId: string | null = null;
    if (action === "exported") {
      congressusInvoiceId = prompt(
        `Mark ${g.name}'s order(s) (${euro(g.totalCents)}) as exported?\n\nOptional: the Congressus invoice number:`,
        ""
      );
      if (congressusInvoiceId === null) return; // cancelled
    } else if (
      !confirm(
        `Put ${g.name}'s order(s) (${euro(g.totalCents)}) back to pending?\n\nOnly do this if Congressus has NO invoice for them from this export — the next export will include them again.`
      )
    ) {
      return;
    }
    setBusy(g.key);
    const res = await fetch("/api/admin/invoices/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, ids: g.ids, action, congressusInvoiceId: congressusInvoiceId || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return alert(d.error ?? "Could not resolve");
    load();
    onResolved();
  }

  if (groups.length === 0) return null;
  const prefix = system === "ppp" ? "PPP" : "SSS";

  return (
    <section className="mb-6 rounded-2xl border border-amber-600/60 bg-amber-900/15 p-4">
      <h2 className="font-semibold text-amber-200">
        ⚠️ {groups.length} export{groups.length === 1 ? "" : "s"} need{groups.length === 1 ? "s" : ""} a check
      </h2>
      <p className="mb-3 text-sm text-amber-100/70">
        The outcome of these Congressus invoices is unknown (e.g. a timeout). In Congressus, check whether the member
        has a &ldquo;{prefix} &lt;month&gt;&rdquo; invoice from that moment, then resolve it here. They&apos;re locked
        until then, so they can never be billed twice.
      </p>
      <ul className="space-y-2">
        {groups.map((g) => {
          const waitUntil = g.claimedAt ? new Date(g.claimedAt.getTime() + MIN_CLAIM_AGE_MS) : null;
          const tooSoon = waitUntil != null && waitUntil.getTime() > Date.now();
          return (
            <li key={g.key} className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-900/70 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{g.name}</span>
                <span className="ml-2 text-sm text-gray-400">
                  {g.ids.length} order{g.ids.length === 1 ? "" : "s"} · {euro(g.totalCents)}
                  {g.claimedAt && ` · export started ${g.claimedAt.toLocaleString()}`}
                </span>
              </span>
              {tooSoon ? (
                <span className="text-xs text-gray-400">
                  Export may still be running — resolve after {waitUntil!.toLocaleTimeString()}
                </span>
              ) : (
                <>
                  <button
                    onClick={() => resolve(g, "exported")}
                    disabled={busy === g.key}
                    className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium hover:bg-green-600 disabled:opacity-40"
                  >
                    It&apos;s in Congressus → mark exported
                  </button>
                  <button
                    onClick={() => resolve(g, "pending")}
                    disabled={busy === g.key}
                    className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-40"
                  >
                    Not in Congressus → back to pending
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
