"use client";

import { useEffect, useState } from "react";
import { ASSOCIATION_IDS, ASSOCIATION_LABEL, type AssociationId } from "@/lib/associations";
import { usePppMe } from "@/lib/usePppMe";

interface LinkedMember {
  id: string;
  name: string;
  email: string;
  cardCount: number;
}
interface Bartender {
  id: string;
  email: string;
  association: string | null;
  createdAt: string;
  passwordSet: boolean;
  member: LinkedMember | null;
}
interface MemberResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  cardCount: number;
}

export default function BartendersPage() {
  const [bartenders, setBartenders] = useState<Bartender[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  // A bartender works for one association: the login's own, or picked by the overall admin.
  const me = usePppMe();
  const [association, setAssociation] = useState<AssociationId>("stress");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);

  // member link picker
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberResult[]>([]);

  async function load() {
    const res = await fetch("/api/admin/ppp/bartenders");
    if (res.ok) setBartenders((await res.json()).bartenders);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  // Debounced member search while a picker is open.
  useEffect(() => {
    if (linkingId == null || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/admin/members/search?q=${encodeURIComponent(query.trim())}`);
      if (res.ok) setResults((await res.json()).members);
    }, 250);
    return () => clearTimeout(t);
  }, [query, linkingId]);

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
      body: JSON.stringify({ email: addr, association }),
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

  async function linkMember(bartenderId: string, memberId: string | null) {
    setError("");
    const res = await fetch(`/api/admin/ppp/bartenders/${bartenderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId }),
    });
    const d = await res.json();
    if (res.ok) {
      setBartenders((prev) => prev.map((b) => (b.id === bartenderId ? { ...b, member: d.member } : b)));
      setLinkingId(null);
      setQuery("");
      setResults([]);
    } else {
      setError(d.error ?? "Could not link member");
    }
  }

  // The overall admin sees every association's bartenders, grouped per association;
  // a Stress or Dimensie login only gets its own (no headers needed).
  const groups = me?.overall
    ? ASSOCIATION_IDS.map((a) => ({
        label: ASSOCIATION_LABEL[a] as string | null,
        items: bartenders.filter((b) => b.association === ASSOCIATION_LABEL[a]),
      })).filter((g) => g.items.length > 0)
    : [{ label: null as string | null, items: bartenders }];

  return (
    <div className="p-8">
      <div className="mb-2">
        <h1 className="text-3xl font-bold">Bartenders</h1>
        <p className="text-gray-500">
          Create a bartender by email — they get a (non-expiring) link to set their password.
          Link them to a member so they can also log in by scanning their card.
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
        {me?.overall && (
          <select
            value={association}
            onChange={(e) => setAssociation(e.target.value as AssociationId)}
            className="rounded-lg bg-gray-800 px-3 py-2.5 outline-none focus:ring-2 focus:ring-amber-500"
          >
            {ASSOCIATION_IDS.map((a) => (
              <option key={a} value={a}>
                {ASSOCIATION_LABEL[a]}
              </option>
            ))}
          </select>
        )}
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
        <div className="max-w-2xl space-y-6">
          {groups.map((g) => (
            <div key={g.label ?? "all"}>
              {g.label && (
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
                  {g.label} bartenders <span className="font-normal text-gray-600">({g.items.length})</span>
                </h2>
              )}
              <ul className="space-y-2">
          {g.items.map((b) => (
            <li key={b.id} className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
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
                    onClick={() => {
                      setLinkingId(linkingId === b.id ? null : b.id);
                      setQuery("");
                      setResults([]);
                    }}
                    disabled={actingId === b.id}
                    className={`rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-40 ${
                      linkingId === b.id ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-200 hover:bg-amber-600"
                    }`}
                  >
                    🔗 {b.member ? "Change card" : "Link card"}
                  </button>
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
              </div>

              {/* Linked member line */}
              <div className="mt-2 text-sm">
                {b.member ? (
                  <span className="text-gray-300">
                    🪪 Card login as <span className="font-medium">{b.member.name}</span>
                    {b.member.cardCount === 0 && (
                      <span className="text-amber-400"> — no card registered yet</span>
                    )}
                    <button
                      onClick={() => linkMember(b.id, null)}
                      className="ml-2 text-xs text-gray-500 underline hover:text-red-400"
                    >
                      unlink
                    </button>
                  </span>
                ) : (
                  <span className="text-gray-600">Not linked — password login only</span>
                )}
              </div>

              {/* Member picker */}
              {linkingId === b.id && (
                <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search member by name or email…"
                    className="w-full rounded-lg bg-gray-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  {query.trim().length >= 2 && (
                    <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto">
                      {results.length === 0 ? (
                        <li className="px-2 py-1 text-sm text-gray-500">No matches.</li>
                      ) : (
                        results.map((m) => (
                          <li key={m.id}>
                            <button
                              onClick={() => linkMember(b.id, m.id)}
                              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-800"
                            >
                              <span className="min-w-0">
                                <span className="font-medium">{m.firstName} {m.lastName}</span>
                                <span className="ml-2 text-gray-500">{m.email}</span>
                              </span>
                              <span className={`flex-shrink-0 text-xs ${m.cardCount > 0 ? "text-green-400" : "text-amber-400"}`}>
                                {m.cardCount > 0 ? `${m.cardCount} card${m.cardCount === 1 ? "" : "s"}` : "no card"}
                              </span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
