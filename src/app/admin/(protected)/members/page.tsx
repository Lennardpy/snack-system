"use client";

import { useEffect, useState } from "react";

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
  const [members, setMembers] = useState<Member[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/admin/members")
      .then((r) => r.json())
      .then((d) => setMembers(d.members ?? []));
  }, []);

  async function sync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch("/api/admin/members/sync", { method: "POST" });
    const data = await res.json();
    setSyncResult(`Sync complete: ${data.created} created, ${data.updated} updated (${data.total} total)`);
    setSyncing(false);
    fetch("/api/admin/members")
      .then((r) => r.json())
      .then((d) => setMembers(d.members ?? []));
  }

  const filtered = members.filter(
    (m) =>
      `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Members</h1>
        <button
          onClick={sync}
          disabled={syncing}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-5 py-2 rounded-lg font-semibold"
        >
          {syncing ? "Syncing…" : "Sync from Congressus"}
        </button>
      </div>

      {syncResult && <p className="mb-4 text-blue-300">{syncResult}</p>}

      <input
        type="search"
        placeholder="Search members…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm bg-gray-800 rounded-lg px-4 py-2 mb-6 outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="space-y-2">
        {filtered.map((m) => (
          <div key={m.id} className="bg-gray-800 rounded-xl px-5 py-3 flex items-center justify-between">
            <div>
              <p className="font-medium">{m.firstName} {m.lastName}</p>
              <p className="text-gray-400 text-sm">{m.email}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">{m.cards.length} card(s) linked</p>
              {!m.active && <p className="text-xs text-red-400">Inactive</p>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-gray-500">No members found.</p>}
      </div>
    </main>
  );
}
