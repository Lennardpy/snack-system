"use client";

import { useEffect, useRef, useState } from "react";

// Shared NFC card-reader hook used by both the snack kiosk and the PPP bar POS.
// Two input modes, chosen per-device:
//   "ws"  — a reader broadcasting card taps over a WebSocket (e.g. Arago on a
//           laptop). Connects to `wsUrl` and auto-reconnects.
//   "hid" — a USB/Bluetooth NFC reader in keyboard-wedge mode that "types" the
//           UID followed by Enter. Works in any browser (e.g. iPad Safari).
// Mode resolves from the ?mode= URL query first (per device), then `envMode`.
//
// The raw UID string is handed to `onScan` verbatim — normalisation happens
// server-side via normalizeUid(), so both modes/readers stay in sync.

export type ReaderMode = "ws" | "hid";
export type WsStatus = "connecting" | "connected" | "disconnected";

const RECONNECT_DELAY_MS = 3000;

interface Options {
  onScan: (uid: string) => void;
  wsUrl: string;
  envMode?: ReaderMode;
  // When false, HID keystroke bursts are ignored (e.g. a modal is open). The
  // hook already ignores bursts while an input/textarea is focused.
  enabled?: boolean;
}

export function useCardReader({ onScan, wsUrl, envMode = "ws", enabled = true }: Options) {
  const [mode, setMode] = useState<ReaderMode | null>(null); // null until resolved
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");

  // Stable refs so the long-lived listeners never capture stale closures.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve the mode on mount: ?mode=hid|ws wins, else the build-time default.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("mode");
    setMode(q === "hid" || q === "ws" ? (q as ReaderMode) : envMode);
  }, [envMode]);

  // ── Keyboard-wedge input (HID readers) ──────────────────────────────────────
  useEffect(() => {
    if (!mode) return;
    let buffer = "";
    let lastKeyAt = 0;

    const onKey = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      // Don't intercept real typing in form fields.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      const now = Date.now();
      if (now - lastKeyAt > 500) buffer = ""; // reset if it wasn't a fast burst
      lastKeyAt = now;

      if (e.key === "Enter") {
        const uid = buffer.trim();
        buffer = "";
        if (uid.length >= 3) onScanRef.current(uid);
        return;
      }
      if (e.key.length === 1 && /[0-9A-Za-z]/.test(e.key)) buffer += e.key;
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  // ── WebSocket input (laptop reader). Only connects in "ws" mode. ────────────
  useEffect(() => {
    if (mode !== "ws") return;

    let destroyed = false;

    function connect() {
      if (destroyed) return;
      setWsStatus("connecting");

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!destroyed) setWsStatus("connected");
      };

      ws.onmessage = (event: MessageEvent) => {
        if (destroyed || !enabledRef.current) return;
        try {
          const data = JSON.parse(event.data as string) as { uid?: string };
          if (data.uid) onScanRef.current(data.uid);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (destroyed) return;
        setWsStatus("disconnected");
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close(); // onclose handles reconnect
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
  }, [mode, wsUrl]);

  return { mode, wsStatus };
}
