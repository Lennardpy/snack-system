"use client";

import { useEffect, useState } from "react";

interface Bartender {
  id: string;
  email: string;
  createdAt: string;
  passwordSet: boolean;
}

export default function BartendersPage() {
  const [bartenders, setBartenders] = useState<Bartender[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/ppp/bartenders");
    if (res.ok) setBartenders((await res.json()).bartenders);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setBusy(true);
    setError("");
    setNotice("");
    const res = await fetch("/api/admin/ppp/bartenders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: addr }),
    });
    const d = await res.json();
    setBusy(false);
    if (res.ok) {
      setEmail("");
      setNotice(d.warning ?? `Invite sent to ${addr}. The link does not expire.`);
      load();
    } else {
      setError(d.error ?? "Could not create bartender");
    }
  }

  async function resend(b: Bartender) {
    setActingId(b.id);
    setError("");
    setNotice("");
    const res = await fetch(`/api/admin/ppp/bartenders/${b.id}/resend`, { method: "POST" });
    setActingId(null);
    if (res.ok) setNotice(`A fresh set-password link was sent to ${b.email}.`);
    else setError((await res.json()).error ?? "Could not resend");
  }

  async function remove(b: Bartender) {
    if (!confirm(`Delete bartender ${b.email}? They will lose access immediately.`)) return;
    setActingId(b.id);
    const res = await fetch(`/api/admin/ppp/bartenders/${b.id}`, { method: "DELETE" });
    setActingId(null);
    if (res.ok) setBartenders((prev) => prev.filter((x) => x.id !== b.id));
    else setError((await res.json()).error ?? "Could not delete");
  }

  return (
    <div className="p-8">
      <div className="mb-2">
        <h1 className="text-3xl font-bold">Bartenders</h1>
        <p className="text-gray-500">
          Create a bartender by email — they get a link to set their own password. The link
          does not expire.
        </p>
      </div>

      <form onSubmit={invite} className="my-6 flex flex-wrap items-end gap-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="bartender@example.com"
          className="w-72 rounded-lg bg-gray-800 px-4 py-2.5 outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="rounded-xl bg-amber-600 px-5 py-2.5 font-semibold transition-colors hover:bg-amber-500 disabled:opacity-40"
        >
          {busy ? "Sending…" : "Create & send link"}
        </button>
      </form>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {notice && <p className="mb-4 rounded-lg bg-amber-900/30 px-4 py-2 text-sm text-amber-200">{notice}</p>}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : bartenders.length === 0 ? (
        <p className="text-gray-500">No bartenders yet. Add one above.</p>
      ) : (
        <ul className="max-w-2xl space-y-2">
          {bartenders.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{b.email}</p>
                <p className="text-xs">
                  {b.passwordSet ? (
                    <span className="text-green-400">Active</span>
                  ) : (
                    <span className="text-amber-400">Invite pending</span>
                  )}
                  <span className="text-gray-600"> · added {new Date(b.createdAt).toLocaleDateString()}</span>
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  onClick={() => resend(b)}
                  disabled={actingId === b.id}
                  className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 transition-colors hover:bg-amber-600 disabled:opacity-40"
                >
                  {b.passwordSet ? "Reset link" : "Resend link"}
                </button>
                <button
                  onClick={() => remove(b)}
                  disabled={actingId === b.id}
                  className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
