"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Member {
  id: string;
  congressusId: number;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
  cards: { uid: string; name: string | null }[];
}

export default function MembersPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/members")
      .then((r) => r.json())
      .then((d) => setMembers(d.members ?? []));
  }

  useEffect(load, []);

  async function sync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch("/api/admin/members/sync", { method: "POST" });
    const data = await res.json();
    setSyncResult(`Sync complete: ${data.created} created, ${data.updated} updated (${data.total} total)`);
    setSyncing(false);
    load();
  }

  async function enterStore(m: Member) {
    setBusyId(m.id);
    const res = await fetch(`/api/admin/members/${m.id}/shop`, { method: "POST" });
    const data = await res.json();
    setBusyId(null);
    if (res.ok && data.token) {
      router.push(`/shop/${data.token}`);
    } else {
      alert(data.error ?? "Could not open the store for this member.");
    }
  }

  async function remove(m: Member) {
    if (!confirm(`Delete ${m.firstName} ${m.lastName}? This removes their cards and cannot be undone.`)) return;
    setBusyId(m.id);
    const res = await fetch(`/api/admin/members/${m.id}`, { method: "DELETE" });
    const data = await res.json();
    setBusyId(null);
    if (res.ok) {
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
    } else {
      alert(data.error ?? "Could not delete member.");
    }
  }

  const filtered = members.filter((m) =>
    `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Members</h1>
          <p className="text-gray-500">{members.length} total</p>
        </div>
        <button
          onClick={sync}
          disabled={syncing}
          className="rounded-xl bg-blue-600 px-5 py-2.5 font-semibold transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          {syncing ? "Syncing…" : "Sync from Congressus"}
        </button>
      </div>

      {syncResult && (
        <p className="mb-4 rounded-lg bg-blue-900/30 px-4 py-2 text-blue-300">{syncResult}</p>
      )}

      <input
        type="search"
        placeholder="Search by name or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-6 w-full max-w-md rounded-xl bg-gray-800 px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {filtered.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-sm font-bold">
                {m.firstName[0]}{m.lastName[0]}
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-semibold">
                  <span className="truncate">{m.firstName} {m.lastName}</span>
                  {!m.active && (
                    <span className="flex-shrink-0 rounded-full bg-red-900/50 px-2 py-0.5 text-xs text-red-300">Inactive</span>
                  )}
                </p>
                <p className="truncate text-sm text-gray-400">{m.email}</p>
                <p className="text-xs text-gray-600">{m.cards.length} card(s) linked</p>
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                onClick={() => enterStore(m)}
                disabled={busyId === m.id}
                title="Open the kiosk shop as this member"
                className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-blue-600 disabled:opacity-40"
              >
                🛒 Enter store
              </button>
              <button
                onClick={() => remove(m)}
                disabled={busyId === m.id}
                title="Delete member"
                className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-gray-400 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-40"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-gray-500">No members found.</p>}
      </div>
    </div>
  );
}
