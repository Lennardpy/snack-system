"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { formatRoleDiscount } from "@/lib/roles";

interface Role {
  id: string;
  name: string;
  discountPercent: number;
  discountCents: number;
  color: string | null;
}
interface CardInfo {
  id: string;
  uid: string;
  name: string | null;
  createdAt: string;
}
interface Totals {
  spentCents: number;
  openCents: number;
  orders: number;
}
interface Purchase {
  id: string;
  system: "SSS" | "PPP";
  at: string;
  totalCents: number;
  exported: boolean;
  context: string | null;
  lines: { name: string; quantity: number; unitCents: number }[];
}
interface Data {
  member: {
    id: string;
    congressusId: number;
    firstName: string;
    lastName: string;
    email: string;
    active: boolean;
    roles: Role[];
    cards: CardInfo[];
  };
  sss: Totals;
  ppp: Totals;
  purchases: Purchase[];
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function MemberDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "SSS" | "PPP">("all");
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [editingRoles, setEditingRoles] = useState(false);
  const [savingRoles, setSavingRoles] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/members/${id}`);
    if (res.ok) setData(await res.json());
    else setError((await res.json()).error ?? "Could not load member");
  }, [id]);
  useEffect(() => {
    load();
    fetch("/api/admin/ppp/roles")
      .then((r) => r.json())
      .then((d) => setAllRoles(d.roles ?? []))
      .catch(() => {});
  }, [load]);

  // Toggle one role on/off for this member (saves immediately).
  async function toggleRole(roleId: string) {
    if (!data) return;
    const current = data.member.roles;
    const has = current.some((r) => r.id === roleId);
    const roleIds = has ? current.filter((r) => r.id !== roleId).map((r) => r.id) : [...current.map((r) => r.id), roleId];
    setSavingRoles(true);
    const res = await fetch(`/api/admin/members/${id}/roles`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleIds }),
    });
    setSavingRoles(false);
    if (res.ok) {
      const { roles } = await res.json();
      setData((d) => (d ? { ...d, member: { ...d.member, roles } } : d));
    } else {
      alert((await res.json()).error ?? "Could not update roles");
    }
  }

  // Lost card: unlink just this card. The member and their history stay.
  async function unlink(card: CardInfo) {
    if (!data) return;
    const who = `${data.member.firstName} ${data.member.lastName}`;
    if (!confirm(`Unlink card ${card.uid} from ${who}?\n\nThe card stops working immediately. The member, their invoices and history are kept.`)) return;
    setUnlinking(card.id);
    const res = await fetch(`/api/admin/members/${id}/cards/${card.id}`, { method: "DELETE" });
    setUnlinking(null);
    if (res.ok) load();
    else alert((await res.json()).error ?? "Could not unlink card");
  }

  const purchases = useMemo(
    () => (data?.purchases ?? []).filter((p) => filter === "all" || p.system === filter),
    [data, filter]
  );

  if (error) return <div className="p-8 text-red-400">{error}</div>;
  if (!data) return <div className="p-8 text-gray-500">Loading…</div>;

  const { member, sss, ppp } = data;
  const openCents = sss.openCents + ppp.openCents;

  return (
    <div className="p-8">
      <a href="/admin/members" className="text-sm text-gray-400 hover:text-white">
        ← Members
      </a>

      <div className="mb-6 mt-3 flex flex-wrap items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-700 text-lg font-bold">
          {member.firstName[0]}
          {member.lastName[0]}
        </div>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            {member.firstName} {member.lastName}
            {!member.active && (
              <span className="rounded-full bg-red-900/50 px-2 py-0.5 text-xs font-medium text-red-300">Inactive</span>
            )}
          </h1>
          <p className="text-gray-400">
            {member.email} · Congressus #{member.congressusId}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {member.roles.map((r) => (
              <span
                key={r.id}
                className="rounded-full border px-2 py-0.5 text-xs"
                style={r.color ? { borderColor: r.color, color: r.color } : { borderColor: "#9333ea66", color: "#c4b5fd" }}
              >
                {r.name} <span className="opacity-70">{formatRoleDiscount(r)}</span>
              </span>
            ))}
            {member.roles.length === 0 && <span className="text-xs text-gray-600">No roles</span>}
            <button
              onClick={() => setEditingRoles((v) => !v)}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                editingRoles ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-amber-600 hover:text-white"
              }`}
            >
              🎟️ {editingRoles ? "Done" : "Edit roles"}
            </button>
          </div>
        </div>
      </div>

      {/* Role editor — tap a role to add/remove it (drink discounts at the bar) */}
      {editingRoles && (
        <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900 p-4">
          {allRoles.length === 0 ? (
            <p className="text-sm text-gray-500">
              No roles defined yet.{" "}
              <a href="/admin/ppp/roles" className="text-amber-400 underline">
                Create roles
              </a>{" "}
              first.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-gray-500">
                Tap to add or remove. Roles give drink discounts at the bar; the best one wins.
              </p>
              <div className="flex flex-wrap gap-2">
                {allRoles.map((role) => {
                  const active = member.roles.some((r) => r.id === role.id);
                  return (
                    <button
                      key={role.id}
                      onClick={() => toggleRole(role.id)}
                      disabled={savingRoles}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                        active
                          ? "border-amber-500 bg-amber-600/20 text-amber-300"
                          : "border-gray-700 text-gray-400 hover:border-gray-500"
                      }`}
                    >
                      {active ? "✓ " : ""}
                      {role.name} ({formatRoleDiscount(role)})
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Totals */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Total spent" value={euro(sss.spentCents + ppp.spentCents)} sub={`${sss.orders + ppp.orders} orders`} />
        <Kpi label="SSS (snacks)" value={euro(sss.spentCents)} sub={`${sss.orders} order${sss.orders === 1 ? "" : "s"}`} />
        <Kpi label="PPP (bar)" value={euro(ppp.spentCents)} sub={`${ppp.orders} order${ppp.orders === 1 ? "" : "s"}`} />
        <Kpi
          label="Open invoice (not exported)"
          value={euro(openCents)}
          sub={`SSS ${euro(sss.openCents)} · PPP ${euro(ppp.openCents)}`}
          accent={openCents > 0}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Cards */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6 xl:col-span-1">
          <h2 className="mb-1 text-lg font-semibold">Linked cards</h2>
          <p className="mb-4 text-sm text-gray-500">Lost card? Unlink it — the member and their history stay.</p>
          {member.cards.length === 0 ? (
            <p className="text-gray-500">No cards linked.</p>
          ) : (
            <ul className="space-y-2">
              {member.cards.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-800/60 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-semibold">{c.uid}</p>
                    <p className="text-xs text-gray-500">
                      {c.name ? `${c.name} · ` : ""}linked {new Date(c.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => unlink(c)}
                    disabled={unlinking === c.id}
                    className="flex-shrink-0 rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-40"
                  >
                    {unlinking === c.id ? "Unlinking…" : "Unlink"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Purchases */}
        <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6 xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Past purchases</h2>
            <div className="flex rounded-xl bg-gray-800 p-1">
              {(["all", "SSS", "PPP"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                    filter === f ? "bg-blue-600 text-white" : "text-gray-300 hover:text-white"
                  }`}
                >
                  {f === "all" ? "All" : f}
                </button>
              ))}
            </div>
          </div>
          {purchases.length === 0 ? (
            <p className="text-gray-500">No purchases.</p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {purchases.map((p) => (
                <li key={`${p.system}-${p.id}`} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                          p.system === "SSS" ? "bg-blue-500/15 text-blue-300" : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {p.system}
                      </span>
                      <span className="text-gray-300">{fmtDateTime(p.at)}</span>
                      {p.context && <span className="text-gray-500">· {p.context}</span>}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          p.exported ? "bg-gray-700/40 text-gray-400" : "bg-green-500/15 text-green-400"
                        }`}
                      >
                        {p.exported ? "Exported" : "Open"}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      {p.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")}
                    </p>
                  </div>
                  <span className="flex-shrink-0 font-semibold tabular-nums">{euro(p.totalCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${accent ? "border-amber-700/50 bg-amber-900/20" : "border-gray-800 bg-gray-900"}`}>
      <p className="mb-1 text-sm text-gray-400">{label}</p>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}
