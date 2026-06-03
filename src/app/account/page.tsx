"use client";

import { useEffect, useRef, useState } from "react";

export default function AccountPage() {
  const [step, setStep] = useState<"login" | "link" | "done">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cardUid, setCardUid] = useState("");
  const [scanning, setScanning] = useState(false);
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (step !== "link") return;
    setScanning(true);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        const uid = bufferRef.current.trim();
        bufferRef.current = "";
        if (timerRef.current) clearTimeout(timerRef.current);
        if (uid) linkCard(uid);
      } else if (e.key.length === 1) {
        bufferRef.current += e.key;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { bufferRef.current = ""; }, 500);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); setScanning(false); };
  }, [step]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      setStep("link");
    } else {
      const d = await res.json();
      setError(d.error ?? "Login failed");
    }
  }

  async function linkCard(uid: string) {
    setCardUid(uid);
    const res = await fetch("/api/account/link-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid }),
    });
    if (res.ok) {
      setStep("done");
    } else {
      const d = await res.json();
      setError(d.error ?? "Failed to link card");
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold mb-2 text-center">SSS</h1>
        <p className="text-gray-600 text-xs text-center mb-8">Stress Snack System</p>

        {step === "login" && (
          <form onSubmit={login} className="space-y-4">
            <p className="text-gray-400 text-sm text-center mb-6">
              Log in with your association account to link your student card.
            </p>
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-gray-800 rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-gray-800 rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 font-bold py-3 rounded-xl transition-colors"
            >
              Continue
            </button>
          </form>
        )}

        {step === "link" && (
          <div className="text-center">
            <div className="text-7xl mb-6 animate-pulse">🪪</div>
            <p className="text-xl font-semibold mb-2">Now tap your student card</p>
            <p className="text-gray-400 text-sm">Hold it against the reader on this device</p>
            {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
          </div>
        )}

        {step === "done" && (
          <div className="text-center">
            <div className="text-7xl mb-6">✅</div>
            <p className="text-xl font-semibold mb-2">Card linked!</p>
            <p className="text-gray-400 text-sm">
              UID: <code className="font-mono text-gray-300">{cardUid}</code>
            </p>
            <p className="text-gray-400 text-sm mt-3">You can now tap your card at the kiosk.</p>
            <a href="/" className="block mt-6 text-blue-400 underline">
              Go to kiosk
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
