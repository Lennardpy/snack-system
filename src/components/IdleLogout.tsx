"use client";

import { useEffect, useRef, useState } from "react";

// Signs an admin out after `idleMs` without mouse, keyboard or touch input — also
// when the page keeps polling the server (which keeps the server session alive).
// Activity in any tab of the site counts (shared via localStorage). A warning
// with "Stay signed in" shows for the last minute. While someone is active it
// pings the server every few minutes, so the server session (which slides with
// requests) doesn't end under them; if it ended anyway (the 12 h maximum), the
// page goes to the login.
const KEY = "lastActivityAt";
const WARN_MS = 60_000;
const PING_MS = 4 * 60_000;
const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;

const readShared = () => {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
};

export default function IdleLogout({ idleMs, loginPath }: { idleMs: number; loginPath: string }) {
  const last = useRef(0); // set on mount
  const [msLeft, setMsLeft] = useState(idleMs);
  const signingOut = useRef(false);

  useEffect(() => {
    let lastWrite = 0;
    let lastPing = Date.now();
    const touch = () => {
      const now = Date.now();
      last.current = now;
      // mousemove fires a lot: write at most every 5 s.
      if (now - lastWrite > 5_000) {
        lastWrite = now;
        try {
          localStorage.setItem(KEY, String(now));
        } catch {}
      }
    };
    touch();
    for (const e of EVENTS) window.addEventListener(e, touch, { passive: true });

    async function check() {
      const lastAt = Math.max(last.current, readShared());
      const now = Date.now();
      const left = idleMs - (now - lastAt);
      setMsLeft(left);
      if (signingOut.current) return;
      if (left > 0) {
        if (lastAt > lastPing && now - lastPing > PING_MS) {
          lastPing = now;
          const res = await fetch("/api/auth/ping", { cache: "no-store" }).catch(() => null);
          if (res?.status === 401) {
            signingOut.current = true;
            window.location.replace(loginPath);
          }
        }
        return;
      }
      signingOut.current = true;
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      window.location.replace(`${loginPath}?reason=admin-idle`);
    }
    const t = setInterval(check, 5_000);
    // A laptop that slept past the limit signs out as soon as it wakes.
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      for (const e of EVENTS) window.removeEventListener(e, touch);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [idleMs, loginPath]);

  if (msLeft > WARN_MS) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-amber-700/60 bg-gray-900 px-4 py-3 text-sm text-amber-100 shadow-2xl">
      <span>
        No activity — you&apos;ll be signed out in {Math.max(0, Math.ceil(msLeft / 1000))} s.
      </span>
      <button
        onClick={() => {
          last.current = Date.now();
          setMsLeft(idleMs);
          fetch("/api/auth/ping", { cache: "no-store" }).catch(() => {});
        }}
        className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-500"
      >
        Stay signed in
      </button>
    </div>
  );
}
