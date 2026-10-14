"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// External cards: bar cards not linked to a member, e.g. handed to an external
// party at a borrel. Their drinks land on that borrel's external tab (see the
// borrel's Details page) instead of being billed to a member via Congressus.

interface ExternalCard {
  id: string;
  uid: string;
  name: string;
  createdAt: string;
  tabs: { id: string; title: string | null; activity: { id: string; name: string; date: string } }[];
}

export default function ExternalCardsPage() {
  const [cards, setCards] = useState<ExternalCard[] | null>(null);
  const [uid, setUid] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/ppp/external-cards");
    if (res.ok) setCards((await res.json()).cards);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!uid.trim() || !name.trim()) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/ppp/external-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, name }),
    });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Could not add card");
    setUid("");
    setName("");
    load();
  }

  async function rename(c: ExternalCard) {
    const n = prompt("Rename external card", c.name);
    if (!n || !n.trim() || n.trim() === c.name) return;
    const res = await fetch(`/api/admin/ppp/external-cards/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
    if (res.ok) load();
    else alert((await res.json().catch(() => ({}))).error ?? "Could not rename");
  }

  async function remove(c: ExternalCard) {
    if (
      !confirm(
        `Delete external card "${c.name}"?\n\nThe card stops working at the bar. Tabs at past borrels are kept and can still be downloaded.`
      )
    )
      return;
    const res = await fetch(`/api/admin/ppp/external-cards/${c.id}`, { method: "DELETE" });
    if (res.ok) load();
    else alert((await res.json().catch(() => ({}))).error ?? "Could not delete");
  }

  return (
    <div className="p-8">
      <h1 className="mb-1 text-3xl font-bold">External cards</h1>
      <p className="mb-6 max-w-3xl text-sm text-gray-500">
        Cards that aren&apos;t linked to a member — for external parties at a borrel. Drinks tapped on one go on that
        borrel&apos;s external tab: on the borrel&apos;s <b>Details / P&amp;L</b> page you set a title and a price level
        (Internal, Internal + 10%, Tussen 1.5×, External 2×) and download the PDF. Bartenders can also make an unknown
        card external straight from the POS.
      </p>

      <form onSubmit={add} className="mb-8 flex max-w-3xl flex-wrap items-end gap-3 rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">Card UID — tap the card on the reader</span>
          <input
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            // A USB reader types the UID followed by Enter: jump to the name.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                nameRef.current?.focus();
              }
            }}
            placeholder="e.g. 04A1B2C3D4"
            className="w-56 rounded-lg bg-gray-800 px-3 py-2 font-mono outline-none focus:ring-2 focus:ring-amber-500"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-gray-400">Name</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. External card 1"
            maxLength={60}
            className="min-w-[12rem] rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !uid.trim() || !name.trim()}
          className="rounded-xl bg-amber-600 px-5 py-2 font-semibold hover:bg-amber-500 disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add card"}
        </button>
        {error && <p className="w-full text-sm text-red-400">{error}</p>}
      </form>

      {cards === null ? (
        <p className="text-gray-500">Loading…</p>
      ) : cards.length === 0 ? (
        <p className="text-gray-500">No external cards yet.</p>
      ) : (
        <ul className="max-w-3xl space-y-3">
          {cards.map((c) => (
            <li key={c.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">🏷️ {c.name}</p>
                  <p className="font-mono text-xs text-gray-500">{c.uid}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => rename(c)} className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700">
                    Rename
                  </button>
                  <button
                    onClick={() => remove(c)}
                    className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-400 hover:bg-red-600 hover:text-white"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {c.tabs.length > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  Used at:{" "}
                  {c.tabs.map((t, i) => (
                    <span key={t.id}>
                      {i > 0 && ", "}
                      <a href={`/admin/ppp/activities/${t.activity.id}`} className="text-amber-400 hover:underline">
                        {t.activity.name} ({new Date(t.activity.date).toLocaleDateString()})
                      </a>
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
