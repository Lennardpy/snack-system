"use client";

import { useState, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCardReader } from "@/lib/useCardReader";

const WS_URL = process.env.NEXT_PUBLIC_PPP_CARD_READER_WS_URL ?? "ws://localhost:3000";
const PPP_MODE = process.env.NEXT_PUBLIC_PPP_CARD_READER_MODE;
const ENV_MODE = PPP_MODE === "ws" || PPP_MODE === "nfc" ? PPP_MODE : "hid";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/ppp";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    setLoading(false);

    if (res.ok) {
      router.push(from);
      router.refresh();
    } else {
      const d = await res.json();
      setError(d.error ?? "Login failed");
    }
  }

  // Card login — a tapped card whose member is linked to a bartender/admin account.
  const handleCardScan = useCallback(
    async (uid: string) => {
      setScanning(true);
      setError("");
      try {
        const res = await fetch("/api/auth/card-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid }),
        });
        if (res.ok) {
          router.push(from);
          router.refresh();
          return;
        }
        const d = await res.json();
        setError(d.error ?? "Card login failed");
      } catch {
        setError("Connection error");
      }
      setScanning(false);
    },
    [from, router]
  );

  const { mode, wsStatus, nfcStatus, startNfc } = useCardReader({
    onScan: handleCardScan,
    wsUrl: WS_URL,
    envMode: ENV_MODE,
    enabled: !scanning,
  });

  return (
    <div className="w-full max-w-sm space-y-5">
      <div>
        <h1 className="text-2xl font-bold">PPP</h1>
        <p className="text-gray-400 text-xs">Bar POS — sign in with email / password or scan your card</p>
      </div>

      {searchParams.get("reason") === "idle" && !error && (
        <p className="rounded-lg bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
          Signed out — no orders for 1 hour, so the borrel was ended. Sign in again to continue.
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <form onSubmit={login} className="space-y-4">
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Email" required autoFocus
          className="w-full rounded-lg bg-gray-800 px-4 py-3 outline-none focus:ring-2 focus:ring-amber-500"
        />
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password" required
          className="w-full rounded-lg bg-gray-800 px-4 py-3 outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button
          type="submit" disabled={loading}
          className="w-full rounded-xl bg-amber-600 py-3 font-bold transition-colors hover:bg-amber-500 disabled:opacity-40"
        >
          {loading ? "Logging in…" : "Login"}
        </button>
      </form>

      {/* Card login */}
      <div className="flex items-center gap-3 text-xs text-gray-600">
        <span className="h-px flex-1 bg-gray-800" /> or <span className="h-px flex-1 bg-gray-800" />
      </div>
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-center">
        <p className="text-4xl">🪪</p>
        <p className="mt-2 font-medium">{scanning ? "Reading card…" : "Scan your card"}</p>
        {mode === "nfc" && nfcStatus !== "scanning" && (
          <button
            onClick={startNfc}
            disabled={nfcStatus === "unsupported"}
            className="mt-3 w-full rounded-lg bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
          >
            {nfcStatus === "unsupported"
              ? "NFC not available on this device"
              : nfcStatus === "error"
              ? "Retry — enable NFC scanning"
              : "Enable NFC scanning"}
          </button>
        )}
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-gray-500">
          {mode === "nfc" ? (
            <>
              <span
                className={`h-2 w-2 rounded-full ${
                  nfcStatus === "scanning"
                    ? "bg-green-500"
                    : nfcStatus === "unsupported" || nfcStatus === "error"
                    ? "bg-red-500"
                    : "bg-yellow-500"
                }`}
              />
              {nfcStatus === "scanning"
                ? "Ready — hold a card to the phone"
                : nfcStatus === "unsupported"
                ? "Web NFC not supported (use Chrome on Android)"
                : nfcStatus === "error"
                ? "Couldn't start NFC"
                : "Tap “Enable NFC scanning” to start"}
            </>
          ) : mode === "hid" ? (
            <>
              <span className="h-2 w-2 rounded-full bg-green-500" /> Ready to scan
            </>
          ) : (
            <>
              <span
                className={`h-2 w-2 rounded-full ${
                  wsStatus === "connected"
                    ? "bg-green-500"
                    : wsStatus === "connecting"
                    ? "animate-pulse bg-yellow-500"
                    : "bg-red-500"
                }`}
              />
              {wsStatus === "connected" ? "Reader connected" : wsStatus === "connecting" ? "Connecting…" : "Reader offline"}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PppLoginPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
