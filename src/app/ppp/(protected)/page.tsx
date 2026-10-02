"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Activity {
  id: string;
  name: string;
  status: "OPEN" | "CLOSED";
  date: string;
  _count: { invoices: number };
}

export default function ActivitySelectorPage() {
  const router = useRouter();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    // Auto-import any new Stress borrels from Alexia first (fail-soft), so the
    // list always reflects what the bar committee has scheduled.
    await fetch("/api/ppp/alexia/sync", { method: "POST" }).catch(() => {});
    const res = await fetch("/api/ppp/activities");
    if (res.status === 401) {
      // Session ended while this page was open → sign in again.
      router.replace("/ppp/login");
      return;
    }
    if (res.ok) setActivities((await res.json()).activities);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/ppp/login");
    router.refresh();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError("");
    const res = await fetch("/api/ppp/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    setCreating(false);
    if (res.ok) {
      const d = await res.json();
      router.push(`/ppp/${d.activity.id}`);
    } else {
      const d = await res.json();
      setError(d.error ?? "Could not create activity");
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-bold">PPP Bar POS</h1>
          <p className="text-sm text-gray-400">Pick an activity or start a new one</p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/admin" className="text-sm text-gray-500 hover:text-gray-300">
            Admin
          </a>
          <button
            onClick={logout}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
          >
            Log out
          </button>
        </div>
      </div>

      <form onSubmit={create} className="mb-8 flex gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New activity name (e.g. Borrel 28 jun)"
          className="flex-1 rounded-lg bg-gray-800 px-4 py-3 outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="rounded-xl bg-amber-600 px-6 py-3 font-bold transition-colors hover:bg-amber-500 disabled:opacity-40"
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </form>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : activities.length === 0 ? (
        <p className="text-gray-500">No activities yet. Create one above to start selling.</p>
      ) : (
        <ul className="space-y-2">
          {activities.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => router.push(`/ppp/${a.id}`)}
                className="flex w-full items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-5 py-4 text-left transition-colors hover:border-gray-600"
              >
                <span>
                  <span className="font-semibold">{a.name}</span>
                  <span className="ml-3 text-xs text-gray-500">
                    {new Date(a.date).toLocaleDateString()} · {a._count.invoices} order
                    {a._count.invoices === 1 ? "" : "s"}
                  </span>
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    a.status === "OPEN"
                      ? "bg-green-500/15 text-green-400"
                      : "bg-gray-700/40 text-gray-400"
                  }`}
                >
                  {a.status === "OPEN" ? "Open" : "Closed"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
