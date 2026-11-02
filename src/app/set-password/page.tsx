"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function SetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [state, setState] = useState<"loading" | "ready" | "invalid">("loading");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState("invalid");
      setError("This link is missing its token.");
      return;
    }
    fetch(`/api/auth/set-password?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.ok) {
          const d = await r.json();
          setEmail(d.email);
          setState("ready");
        } else {
          const d = await r.json();
          setError(d.error ?? "This link is not valid.");
          setState("invalid");
        }
      })
      .catch(() => {
        setError("Could not check this link.");
        setState("invalid");
      });
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw.length < 8) return setError("Password must be at least 8 characters.");
    if (pw !== pw2) return setError("Passwords do not match.");

    setSubmitting(true);
    const res = await fetch("/api/auth/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: pw }),
    });
    setSubmitting(false);
    if (res.ok) {
      const { home } = await res.json();
      // No home = this account signs in on the other site; its login link is in the email.
      router.push(home ?? "/admin/login");
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Could not set password.");
    }
  }

  if (state === "loading") {
    return <p className="text-gray-400">Checking your link…</p>;
  }
  if (state === "invalid") {
    return (
      <div className="text-center">
        <div className="mb-3 text-5xl">🔗</div>
        <h1 className="mb-2 text-2xl font-bold">Link not valid</h1>
        <p className="text-gray-400">{error}</p>
        <p className="mt-4 text-sm text-gray-500">Ask an admin to resend your invite.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Set your password</h1>
        <p className="text-sm text-gray-400">for {email}</p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <input
        type="password" value={pw} onChange={(e) => setPw(e.target.value)}
        placeholder="New password (min 8 chars)" required autoFocus
        className="w-full rounded-lg bg-gray-800 px-4 py-3 outline-none focus:ring-2 focus:ring-amber-500"
      />
      <input
        type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
        placeholder="Confirm password" required
        className="w-full rounded-lg bg-gray-800 px-4 py-3 outline-none focus:ring-2 focus:ring-amber-500"
      />
      <button
        type="submit" disabled={submitting}
        className="w-full rounded-xl bg-amber-600 py-3 font-bold transition-colors hover:bg-amber-500 disabled:opacity-40"
      >
        {submitting ? "Saving…" : "Set password & sign in"}
      </button>
    </form>
  );
}

export default function SetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 p-6 text-white">
      <Suspense>
        <SetPasswordForm />
      </Suspense>
    </main>
  );
}
