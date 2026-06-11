"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type Status = "idle" | "scanning" | "unregistered" | "email_sent" | "email_not_found" | "error";
type WsStatus = "connecting" | "connected" | "disconnected";

// Input mode for card UIDs:
//   "ws"  — Arago Card Reader broadcasting over a WebSocket (kiosk laptop, default).
//   "hid" — a USB/Bluetooth NFC reader in keyboard-wedge mode that "types" the UID
//           followed by Enter. Works in any browser (e.g. iPad Safari), no WebSocket.
// Resolved from the ?mode= URL query first (per-device), then the build-time env,
// so one deployment can serve both a laptop kiosk and an iPad kiosk.
type ReaderMode = "ws" | "hid";

// Arago Card Reader WebSocket server (runs on the kiosk laptop).
// Default port matches the reader's default (3000).
// Override via NEXT_PUBLIC_CARD_READER_WS_URL if the reader uses a different port.
const WS_URL =
  process.env.NEXT_PUBLIC_CARD_READER_WS_URL ?? "ws://localhost:3000";
const RECONNECT_DELAY_MS = 3000;
const ENV_MODE: ReaderMode =
  process.env.NEXT_PUBLIC_CARD_READER_MODE === "hid" ? "hid" : "ws";

export default function KioskPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [mode, setMode] = useState<ReaderMode | null>(null); // null until resolved
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const scannedUidRef = useRef("");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a stable ref to the latest handleScan so the WebSocket closure
  // never captures a stale version.
  const handleScanRef = useRef<(uid: string) => void>(() => {});
  // Current status, read inside the keyboard-wedge listener without resubscribing.
  const statusRef = useRef<Status>(status);
  statusRef.current = status;

  // Resolve the reader mode on mount: ?mode=hid|ws wins, else the build-time env.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("mode");
    setMode(q === "hid" || q === "ws" ? (q as ReaderMode) : ENV_MODE);
  }, []);

  async function handleScan(uid: string) {
    setStatus("scanning");
    setError("");

    try {
      const res = await fetch("/api/card/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid }),
      });

      const data = await res.json();

      if (res.ok) {
        router.push(`/shop/${data.token}`);
        return;
      }

      if (data.error === "Card not registered") {
        scannedUidRef.current = uid;
        setStatus("unregistered");
      } else {
        setError(data.error ?? "Unknown error");
        setStatus("error");
        setTimeout(() => setStatus("idle"), 4000);
      }
    } catch {
      setError("Connection error");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
    }
  }

  // Always keep the ref pointing at the latest closure
  handleScanRef.current = handleScan;

  // ── Keyboard-wedge input (HID NFC readers, e.g. iPad + USB-C/Bluetooth reader) ──
  // The reader "types" the card UID followed by Enter. We buffer those keystrokes
  // (only on the idle screen, and not while a form field is focused) and treat the
  // burst as a scanned UID.
  useEffect(() => {
    if (!mode) return; // wait until resolved
    let buffer = "";
    let lastKeyAt = 0;

    const onKey = (e: KeyboardEvent) => {
      // Don't intercept real typing (e.g. the email field) or non-idle screens.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (statusRef.current !== "idle") return;

      const now = Date.now();
      if (now - lastKeyAt > 500) buffer = ""; // reset if it wasn't a fast burst
      lastKeyAt = now;

      if (e.key === "Enter") {
        const uid = buffer.trim();
        buffer = "";
        if (uid.length >= 3) handleScanRef.current(uid);
        return;
      }
      if (e.key.length === 1 && /[0-9A-Za-z]/.test(e.key)) buffer += e.key;
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  // ── Arago WebSocket input (laptop kiosk). Only connects in "ws" mode. ──
  useEffect(() => {
    if (mode !== "ws") return; // HID/iPad kiosks don't use the WebSocket

    let destroyed = false;

    function connect() {
      if (destroyed) return;

      setWsStatus("connecting");

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!destroyed) setWsStatus("connected");
      };

      ws.onmessage = (event: MessageEvent) => {
        if (destroyed) return;
        try {
          const data = JSON.parse(event.data as string) as {
            uid?: string;
            atqa?: string;
            sak?: string;
          };
          if (data.uid) {
            handleScanRef.current(data.uid);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (destroyed) return;
        setWsStatus("disconnected");
        // Auto-reconnect after a short delay
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        // onclose fires after onerror — reconnect is handled there
        ws.close();
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // suppress reconnect on unmount
        wsRef.current.close();
      }
    };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const res = await fetch("/api/card/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: scannedUidRef.current, email }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (res.ok) {
      setStatus("email_sent");
      setTimeout(() => {
        setStatus("idle");
        setEmail("");
      }, 8000);
    } else if (data.code === "EMAIL_NOT_FOUND") {
      // Email doesn't match any member — show a dedicated, helpful screen.
      setStatus("email_not_found");
    } else {
      setError(data.error ?? "Failed to send email");
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center select-none px-6">

      {status === "idle" && (
        <div className="relative flex flex-col items-center text-center">
          {/* Soft glow behind the logo */}
          <div className="pointer-events-none absolute -top-16 h-80 w-80 rounded-full bg-blue-600/20 blur-3xl" />

          <Image
            src="/stress-logo.svg"
            alt="Stress"
            width={200}
            height={200}
            priority
            className="relative mb-8 select-none animate-float drop-shadow-2xl"
          />

          <h2 className="mb-20 bg-gradient-to-b from-white to-gray-500 bg-clip-text text-5xl md:text-6xl font-extrabold tracking-tight text-transparent">
            Stress Snack System
          </h2>

          <h1 className="text-7xl md:text-8xl font-bold mb-5">Tap your card</h1>
          <p className="text-gray-400 text-2xl md:text-3xl">Hold your student card against the reader</p>
        </div>
      )}

      {status === "scanning" && (
        <>
          <div className="text-9xl mb-10 animate-pulse">⏳</div>
          <h1 className="text-5xl md:text-6xl font-bold">Checking card…</h1>
        </>
      )}

      {status === "unregistered" && (
        <div className="w-full max-w-lg text-center">
          <div className="text-8xl mb-8">❓</div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Card not registered</h1>
          <p className="text-gray-400 text-xl md:text-2xl mb-10">
            Enter your association email to link this card to your SSS account.
            We&apos;ll send you a one-click verification link.
          </p>
          {error && <p className="text-red-400 text-lg mb-4">{error}</p>}
          <form onSubmit={submitEmail} className="space-y-4">
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full bg-gray-800 rounded-xl px-5 py-4 text-center text-2xl outline-none focus:ring-2 focus:ring-blue-500 select-text"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 font-bold text-2xl py-4 rounded-xl transition-colors"
            >
              {submitting ? "Sending…" : "Send verification email"}
            </button>
          </form>
          <button
            onClick={() => setStatus("idle")}
            className="mt-6 text-gray-500 hover:text-gray-300 text-lg"
          >
            Cancel
          </button>
        </div>
      )}

      {status === "email_sent" && (
        <>
          <div className="text-8xl mb-8">📧</div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Check your email</h1>
          <p className="text-gray-400 text-center text-xl md:text-2xl max-w-xl">
            A verification link has been sent to <strong className="text-white">{email}</strong>.
            Click it to link your card and open the shop.
          </p>
          <p className="text-gray-600 text-lg mt-8">Returning to kiosk in a moment…</p>
        </>
      )}

      {status === "email_not_found" && (
        <div className="w-full max-w-xl text-center">
          <div className="text-8xl mb-8">🔍</div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Email not found</h1>
          <p className="text-gray-300 text-xl md:text-2xl mb-3">
            Did you use the email you log into the Stress website with?
          </p>
          <p className="text-gray-500 text-lg md:text-xl mb-10">
            If this issue persists, contact the board.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => setStatus("unregistered")}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 font-bold text-xl px-8 py-4 rounded-xl transition-colors"
            >
              Try another email
            </button>
            <button
              onClick={() => { setStatus("idle"); setEmail(""); }}
              className="w-full sm:w-auto text-gray-500 hover:text-gray-300 text-lg px-4 py-4"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {status === "error" && (
        <>
          <div className="text-9xl mb-10">❌</div>
          <h1 className="text-5xl md:text-6xl font-bold mb-6 text-red-400">Something went wrong</h1>
          <p className="text-gray-400 text-2xl md:text-3xl">{error}</p>
        </>
      )}

      {/* Reader status indicator. In HID mode there's no connection to monitor —
          the reader is just a keyboard — so we show a steady "Ready to scan". */}
      <div className="absolute top-4 right-4 flex items-center gap-2 text-xs">
        {mode === "hid" ? (
          <>
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-gray-600">Ready to scan</span>
          </>
        ) : (
          <>
            <span
              className={`w-2 h-2 rounded-full ${
                wsStatus === "connected"
                  ? "bg-green-500"
                  : wsStatus === "connecting"
                  ? "bg-yellow-500 animate-pulse"
                  : "bg-red-500"
              }`}
            />
            <span className="text-gray-600">
              {wsStatus === "connected"
                ? "Reader connected"
                : wsStatus === "connecting"
                ? "Connecting…"
                : "Reader offline"}
            </span>
          </>
        )}
      </div>

      <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-gray-700 text-xs whitespace-nowrap">
        SSS &mdash; Stress Snack System
      </p>
      <a href="/admin" className="absolute bottom-6 right-6 text-gray-700 text-sm hover:text-gray-500">
        Admin
      </a>
    </main>
  );
}
