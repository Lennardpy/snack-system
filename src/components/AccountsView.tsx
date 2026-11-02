"use client";

import { useEffect, useState } from "react";
import { ASSOCIATION_IDS, ASSOCIATION_LABEL, type AssociationId } from "@/lib/associations";

// Admin logins, for the overall admin (shown in both the SSS and the PPP admin).
// Each login has access to the SSS admin, the PPP admin or both, and works for one
// association — or for all of them (the overall admin). Bartenders are managed on
// the PPP Bartenders page.

interface Account {
  id: string;
  email: string;
  sssAccess: boolean;
  pppAccess: boolean;
  associationId: AssociationId | null;
  association: string;
  passwordSet: boolean;
  createdAt: string;
  self: boolean;
}

type AssocChoice = AssociationId | "all";
const CHOICES: { value: AssocChoice; label: string }[] = [
  ...ASSOCIATION_IDS.map((a) => ({ value: a as AssocChoice, label: ASSOCIATION_LABEL[a] })),
  { value: "all", label: "All (overall admin)" },
];

export default function AccountsView() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: "", sss: false, ppp: true, association: "stress" as AssocChoice });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const res = await fetch("/api/admin/accounts");
    if (res.ok) setAccounts((await res.json()).accounts);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const body = (sss: boolean, ppp: boolean, association: AssocChoice) => ({
    sssAccess: sss,
    pppAccess: ppp,
    associationId: association === "all" ? null : association,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("new");
    setError("");
    setNotice("");
    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.email, ...body(form.sss, form.ppp, form.association) }),
    });
    const d = await res.json();
    setBusy(null);
    if (!res.ok) return setError(d.error ?? "Could not create the account");
    setNotice(d.warning ?? `Account created — a set-password link was emailed to ${d.account.email}.`);
    setForm((f) => ({ ...f, email: "" }));
    load();
  }

  async function update(a: Account, sss: boolean, ppp: boolean, association: AssocChoice) {
    setBusy(a.id);
    setError("");
    const res = await fetch(`/api/admin/accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body(sss, ppp, association)),
    });
    setBusy(null);
    if (!res.ok) return setError((await res.json()).error ?? "Could not save");
    load();
  }

  async function resend(a: Account) {
    setBusy(a.id);
    const res = await fetch(`/api/admin/accounts/${a.id}/resend`, { method: "POST" });
    setBusy(null);
    if (res.ok) setNotice(`A fresh set-password link was sent to ${a.email}.`);
    else setError((await res.json()).error ?? "Could not send");
  }

  async function remove(a: Account) {
    if (!confirm(`Delete the login ${a.email}? They lose access immediately.`)) return;
    setBusy(a.id);
    const res = await fetch(`/api/admin/accounts/${a.id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) setAccounts((xs) => xs.filter((x) => x.id !== a.id));
    else setError((await res.json()).error ?? "Could not delete");
  }

  const checkbox = "h-4 w-4 accent-amber-500";
  const select = "rounded-lg bg-gray-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500";

  return (
    <div className="p-8">
      <div className="mb-2">
        <h1 className="text-3xl font-bold">Accounts</h1>
        <p className="max-w-3xl text-gray-500">
          Admin logins. Each login can use the <span className="text-gray-300">SSS admin</span> (snack system,
          snacks.51vo.nl), the <span className="text-gray-300">PPP admin</span> (bar system, ppp.51vo.nl) or both —
          with a separate sign-in per site. A Stress or Dimensie login only sees its own association; an overall
          admin sees everything and manages these accounts. Dimensie logins can&apos;t use the SSS.
        </p>
      </div>

      <form onSubmit={create} className="my-6 flex flex-wrap items-end gap-3">
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="treasurer@example.com"
          className="w-72 rounded-lg bg-gray-800 px-4 py-2.5 outline-none focus:ring-2 focus:ring-amber-500"
        />
        <label className="flex items-center gap-2 pb-2.5 text-sm text-gray-300">
          <input type="checkbox" className={checkbox} checked={form.sss} onChange={(e) => setForm((f) => ({ ...f, sss: e.target.checked }))} />
          SSS
        </label>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-gray-300">
          <input type="checkbox" className={checkbox} checked={form.ppp} onChange={(e) => setForm((f) => ({ ...f, ppp: e.target.checked }))} />
          PPP
        </label>
        <select
          value={form.association}
          onChange={(e) => setForm((f) => ({ ...f, association: e.target.value as AssocChoice }))}
          className={`${select} py-2.5`}
        >
          {CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy !== null || !form.email.trim()}
          className="rounded-xl bg-amber-600 px-5 py-2.5 font-semibold transition-colors hover:bg-amber-500 disabled:opacity-40"
        >
          {busy === "new" ? "Creating…" : "Create & send link"}
        </button>
      </form>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {notice && <p className="mb-4 rounded-lg bg-amber-900/30 px-4 py-2 text-sm text-amber-200">{notice}</p>}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <ul className="max-w-4xl space-y-2">
          {accounts.map((a) => {
            const choice: AssocChoice = a.associationId ?? "all";
            const locked = a.self || busy === a.id;
            return (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {a.email}
                    {a.self && <span className="ml-2 text-xs text-gray-500">(you)</span>}
                  </p>
                  <p className="text-xs">
                    {a.passwordSet ? <span className="text-green-400">Active</span> : <span className="text-amber-400">Invite pending</span>}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm text-gray-300">
                    <input type="checkbox" className={checkbox} checked={a.sssAccess} disabled={locked} onChange={(e) => update(a, e.target.checked, a.pppAccess, choice)} />
                    SSS
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-gray-300">
                    <input type="checkbox" className={checkbox} checked={a.pppAccess} disabled={locked} onChange={(e) => update(a, a.sssAccess, e.target.checked, choice)} />
                    PPP
                  </label>
                  <select value={choice} disabled={locked} onChange={(e) => update(a, a.sssAccess, a.pppAccess, e.target.value as AssocChoice)} className={select}>
                    {CHOICES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => resend(a)} disabled={busy === a.id} className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-40">
                    {a.passwordSet ? "Reset link" : "Resend"}
                  </button>
                  {!a.self && (
                    <button onClick={() => remove(a)} disabled={busy === a.id} className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-400 hover:bg-red-600 hover:text-white disabled:opacity-40">
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
