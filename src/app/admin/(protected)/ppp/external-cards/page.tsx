"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCardReader } from "@/lib/useCardReader";

// The bar's card reader (same settings as the PPP POS): on the bar PC a WebSocket
// reader (Arago), on an iPad a keyboard-wedge reader, on Android the phone's NFC.
const WS_URL = process.env.NEXT_PUBLIC_PPP_CARD_READER_WS_URL ?? "ws://localhost:3000";
const PPP_MODE = process.env.NEXT_PUBLIC_PPP_CARD_READER_MODE;
const ENV_MODE = PPP_MODE === "ws" || PPP_MODE === "nfc" ? PPP_MODE : "hid";

// External cards: bar cards not linked to a member, e.g. handed to an external
// party at a borrel. Their drinks land on that borrel's external tab (see the
// borrel's Details page) instead of being billed to a member via Congressus.

interface ExternalCard {
  id: string;
  uid: string;
  name: string;
  limitCents: number | null; // spending limit per borrel (internal prices); null = none
  createdAt: string;
  tabs: { id: string; title: string | null; activity: { id: string; name: string; date: string } }[];
}

export default function ExternalCardsPage() {
  const [cards, setCards] = useState<ExternalCard[] | null>(null);
  const [uid, setUid] = useState("");
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  // "Scan card": listen to the card reader until a card is tapped.
  const [scanning, setScanning] = useState(false);
  const onScanned = useCallback((scanned: string) => {
    setUid(scanned);
    setScanning(false);
    setTimeout(() => nameRef.current?.focus(), 0);
  }, []);

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
      body: JSON.stringify({ uid, name, limit }),
    });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Could not add card");
    setUid("");
    setName("");
    setLimit("");
    load();
  }

  async function editLimit(c: ExternalCard) {
    const v = prompt(
      `Spending limit per borrel for "${c.name}", in euros at internal prices (empty = no limit):`,
      c.limitCents != null ? (c.limitCents / 100).toFixed(2) : ""
    );
    if (v === null) return;
    const res = await fetch(`/api/admin/ppp/external-cards/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: v.trim() }),
    });
    if (res.ok) load();
    else alert((await res.json().catch(() => ({}))).error ?? "Could not set the limit");
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
        card external straight from the POS. A <b>limit</b> caps what a card can spend per borrel (at internal
        prices): the POS shows bartenders what&apos;s left and refuses orders over it.
      </p>

      <form onSubmit={add} className="mb-8 flex max-w-3xl flex-wrap items-end gap-3 rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">Card UID</span>
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
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-400">Limit per borrel (€, optional)</span>
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 100"
            className="w-36 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
          />
        </label>
        <div className="flex w-full flex-wrap items-center gap-3">
          {scanning ? (
            <CardScanner onScan={onScanned} onCancel={() => setScanning(false)} />
          ) : (
            <button
              type="button"
              onClick={() => {
                (document.activeElement as HTMLElement | null)?.blur(); // keyboard readers type into the page, not a field
                setScanning(true);
              }}
              className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700"
            >
              🪪 Scan card
            </button>
          )}
          <span className="text-xs text-gray-500">or type / paste the UID</span>
        </div>
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
                  <p className="text-xs text-gray-400">
                    {c.limitCents != null ? `Limit €${(c.limitCents / 100).toFixed(2)} per borrel` : "No limit"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => editLimit(c)} className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700">
                    {c.limitCents != null ? "Change limit" : "Set limit"}
                  </button>
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

// Listens to the bar's card reader while mounted (only while "Scan card" is active,
// so the reader isn't held open otherwise) and hands back the first tapped UID.
function CardScanner({ onScan, onCancel }: { onScan: (uid: string) => void; onCancel: () => void }) {
  const { mode, wsStatus, nfcStatus, startNfc } = useCardReader({ onScan, wsUrl: WS_URL, envMode: ENV_MODE });
  const status =
    mode === "ws"
      ? wsStatus === "connected"
        ? "Tap the card on the reader…"
        : wsStatus === "connecting"
        ? "Connecting to the card reader…"
        : "Card reader not reachable — is the reader app running on this PC?"
      : mode === "nfc"
      ? nfcStatus === "scanning"
        ? "Hold the card against the phone…"
        : nfcStatus === "unsupported"
        ? "NFC isn't available on this device"
        : "Tap “Enable NFC” first"
      : "Tap the card on the reader…";
  const problem = (mode === "ws" && wsStatus === "disconnected") || nfcStatus === "unsupported" || nfcStatus === "error";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-600/60 bg-amber-950/30 px-4 py-2">
      <span className={`text-sm font-medium ${problem ? "text-red-300" : "text-amber-200"}`}>🪪 {status}</span>
      {mode === "nfc" && nfcStatus !== "scanning" && nfcStatus !== "unsupported" && (
        <button type="button" onClick={startNfc} className="rounded-lg bg-amber-600 px-3 py-1 text-sm font-semibold text-white hover:bg-amber-500">
          Enable NFC
        </button>
      )}
      <button type="button" onClick={onCancel} className="text-sm text-gray-400 hover:text-white">
        Cancel
      </button>
    </div>
  );
}
