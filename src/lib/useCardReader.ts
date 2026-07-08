"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Shared NFC card-reader hook used by both the snack kiosk and the PPP bar POS.
// Three input modes, chosen per-device:
//   "ws"  — a reader broadcasting card taps over a WebSocket (e.g. Arago on a
//           laptop). Connects to `wsUrl` and auto-reconnects.
//   "hid" — a USB/Bluetooth NFC reader in keyboard-wedge mode that "types" the
//           UID followed by Enter. Works in any browser (e.g. iPad Safari).
//   "nfc" — the device's own NFC chip via the Web NFC API (`NDEFReader`).
//           Chrome/Edge on Android only, over HTTPS. Arming the reader needs a
//           user gesture, so callers render a button that calls `startNfc()`.
//           An old Android phone becomes a self-contained kiosk this way.
// Mode resolves in order: the ?mode= URL query (explicit per-device override) →
// auto "nfc" when the device supports Web NFC (only Chrome/Edge on Android expose
// `NDEFReader`, so an Android phone "just works" with no query) → `envMode`.
// Only the effect for the ACTIVE mode runs, so adding "nfc" leaves ws/hid alone.
//
// The raw UID/serial string is handed to `onScan` verbatim — normalisation
// happens server-side via normalizeUid(), so every mode/reader stays in sync.

export type ReaderMode = "ws" | "hid" | "nfc";
export type WsStatus = "connecting" | "connected" | "disconnected";
// "unsupported" = not Chrome-Android/HTTPS; "idle" = supported but not yet armed
// (needs the user-gesture startNfc()); "scanning" = armed; "error" = scan failed.
export type NfcStatus = "unsupported" | "idle" | "scanning" | "error";

// Minimal Web NFC typing (not in the default DOM lib).
interface NDEFReadingEvent {
  serialNumber?: string;
}
interface NDEFReaderLike {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((event: NDEFReadingEvent) => void) | null;
  onreadingerror: (() => void) | null;
}

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
  const [nfcStatus, setNfcStatus] = useState<NfcStatus>("idle");

  // Stable refs so the long-lived listeners never capture stale closures.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nfcAbort = useRef<AbortController | null>(null);

  // Resolve the mode on mount. An explicit ?mode=hid|ws|nfc always wins. With no
  // override, auto-pick "nfc" on devices that support Web NFC — only Chrome/Edge
  // on Android expose `NDEFReader`, so an Android phone selects nfc on its own
  // while laptops (ws) and iPads (hid) fall through to the build-time default.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("mode");
    if (q === "hid" || q === "ws" || q === "nfc") {
      setMode(q as ReaderMode);
    } else if ("NDEFReader" in window) {
      setMode("nfc");
    } else {
      setMode(envMode);
    }
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

  // Arm the phone's NFC reader. The FIRST call (which triggers the permission
  // prompt) must come from a user gesture; once the origin is granted, later
  // calls re-arm silently — that's what lets the POS pick up where login left off.
  const startNfc = useCallback(async () => {
    if (typeof window === "undefined" || !("NDEFReader" in window)) {
      setNfcStatus("unsupported");
      return;
    }
    try {
      nfcAbort.current?.abort(); // re-arm cleanly if called twice
      const controller = new AbortController();
      nfcAbort.current = controller;
      const NDEFReaderCtor = (window as unknown as { NDEFReader: new () => NDEFReaderLike }).NDEFReader;
      const reader = new NDEFReaderCtor();
      await reader.scan({ signal: controller.signal });
      reader.onreading = (event: NDEFReadingEvent) => {
        if (!enabledRef.current) return;
        const uid = (event.serialNumber ?? "").trim();
        if (uid) onScanRef.current(uid); // e.g. "04:1a:2b:…"; normalised server-side
      };
      reader.onreadingerror = () => {
        // A tag was in range but unreadable — stay armed for the next tap.
      };
      setNfcStatus("scanning");
    } catch {
      // Permission denied, no NFC hardware, or not a secure context.
      setNfcStatus("error");
    }
  }, []);

  // ── Web NFC (device's own chip, Chrome on Android). Only runs in "nfc" mode,
  //    so ws/hid devices never touch this. Feature-detect, then AUTO-ARM if the
  //    user already granted NFC (e.g. at login) so the POS is ready to scan with
  //    no second "Enable NFC" tap. If not yet granted, the page shows the button. ──
  useEffect(() => {
    if (mode !== "nfc") return;
    if (typeof window === "undefined" || !("NDEFReader" in window)) {
      setNfcStatus("unsupported");
      return;
    }
    setNfcStatus("idle");
    let cancelled = false;
    (async () => {
      try {
        // navigator.permissions may not expose "nfc"; if it throws we just wait
        // for the button. If already granted, arm silently.
        const perm = await navigator.permissions.query({ name: "nfc" as PermissionName });
        if (!cancelled && perm.state === "granted") startNfc();
      } catch {
        /* not queryable — leave the Enable-NFC button for the user */
      }
    })();
    return () => {
      cancelled = true;
      nfcAbort.current?.abort();
      nfcAbort.current = null;
    };
  }, [mode, startNfc]);

  return { mode, wsStatus, nfcStatus, startNfc };
}
