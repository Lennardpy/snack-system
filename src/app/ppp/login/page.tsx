"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/ppp";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  return (
    <form onSubmit={login} className="w-full max-w-sm space-y-4">
      <h1 className="text-2xl font-bold mb-1">PPP</h1>
      <p className="text-gray-400 text-xs mb-6">Bar POS — bartender sign-in</p>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <input
        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="Email" required autoFocus
        className="w-full bg-gray-800 rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-amber-500"
      />
      <input
        type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder="Password" required
        className="w-full bg-gray-800 rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-amber-500"
      />
      <button
        type="submit" disabled={loading}
        className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-40 font-bold py-3 rounded-xl transition-colors"
      >
        {loading ? "Logging in…" : "Login"}
      </button>
    </form>
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
