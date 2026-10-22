"use client";

import { useEffect, useState } from "react";
import { ASSOCIATION_IDS, ASSOCIATION_LABEL, type AssociationId } from "@/lib/associations";
import { usePppMe } from "@/lib/usePppMe";

interface Role {
  id: string;
  associationId: AssociationId;
  name: string;
  discountPercent: number;
  discountCents: number;
  ownDrinkOnly: boolean;
  color: string | null;
  sortOrder: number;
  _count: { members: number };
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountEuro, setDiscountEuro] = useState("");
  const [ownDrinkOnly, setOwnDrinkOnly] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Roles belong to one association: the login's own, or picked by the overall admin.
  const me = usePppMe();
  const [association, setAssociation] = useState<AssociationId>("stress");

  async function load() {
    const res = await fetch("/api/admin/ppp/roles");
    if (res.ok) setRoles((await res.json()).roles);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/ppp/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: trimmed,
        discountPercent: Number(discount || 0),
        discountCents: Math.round(Number(discountEuro || 0) * 100),
        ownDrinkOnly,
        association,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      setDiscount("");
      setDiscountEuro("");
      setOwnDrinkOnly(false);
      load();
    } else {
      setError((await res.json()).error ?? "Could not create role");
    }
  }

  async function updateDiscount(id: string, value: number) {
    const clamped = Math.min(100, Math.max(0, Math.round(value)));
    setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, discountPercent: clamped } : r)));
    await fetch(`/api/admin/ppp/roles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discountPercent: clamped }),
    });
  }

  async function updateCents(id: string, euroValue: number) {
    const cents = Math.max(0, Math.round(euroValue * 100));
    setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, discountCents: cents } : r)));
    await fetch(`/api/admin/ppp/roles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discountCents: cents }),
    });
  }

  async function updateOwnDrinkOnly(id: string, value: boolean) {
    setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, ownDrinkOnly: value } : r)));
    await fetch(`/api/admin/ppp/roles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownDrinkOnly: value }),
    });
  }

  async function remove(role: Role) {
    if (!confirm(`Delete role "${role.name}"? It will be removed from ${role._count.members} member(s).`)) return;
    const res = await fetch(`/api/admin/ppp/roles/${role.id}`, { method: "DELETE" });
    if (res.ok) setRoles((rs) => rs.filter((r) => r.id !== role.id));
  }

  return (
    <div className="p-8">
      <div className="mb-2">
        <h1 className="text-3xl font-bold">Member roles</h1>
        <p className="text-gray-500">
          Roles grant a drink discount at the PPP bar. Highest discount wins when a member has several.
          100% = free. <span className="text-gray-400">Own drink only</span>: the discount applies to one drink per
          order (the member&apos;s own); the rest of a round is charged at the normal price.
        </p>
      </div>

      <form onSubmit={create} className="my-6 flex flex-wrap items-end gap-3">
        {me?.overall && (
          <div>
            <label className="mb-1 block text-xs text-gray-400">Association</label>
            <select
              value={association}
              onChange={(e) => setAssociation(e.target.value as AssociationId)}
              className="rounded-lg bg-gray-800 px-3 py-2.5 outline-none focus:ring-2 focus:ring-amber-500"
            >
              {ASSOCIATION_IDS.map((a) => (
                <option key={a} value={a}>
                  {ASSOCIATION_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-gray-400">Role name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Board, PilsCie, Bartenders"
            className="w-64 rounded-lg bg-gray-800 px-4 py-2.5 outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">Discount %</label>
          <input
            type="number"
            min={0}
            max={100}
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            placeholder="0–100"
            className="w-28 rounded-lg bg-gray-800 px-4 py-2.5 outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">€ off / drink</label>
          <input
            type="number"
            min={0}
            step={0.05}
            value={discountEuro}
            onChange={(e) => setDiscountEuro(e.target.value)}
            placeholder="0.00"
            className="w-28 rounded-lg bg-gray-800 px-4 py-2.5 outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={ownDrinkOnly}
            onChange={(e) => setOwnDrinkOnly(e.target.checked)}
            className="h-4 w-4 accent-amber-500"
          />
          Own drink only
        </label>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-xl bg-amber-600 px-5 py-2.5 font-semibold transition-colors hover:bg-amber-500 disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add role"}
        </button>
      </form>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : roles.length === 0 ? (
        <p className="text-gray-500">No roles yet. Add one above (e.g. Board at 100%).</p>
      ) : (
        <ul className="max-w-3xl space-y-2">
          {roles.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {r.name}
                  {me?.overall && (
                    <span className="ml-2 rounded-full bg-gray-800 px-2 py-0.5 text-xs font-normal text-gray-400">
                      {ASSOCIATION_LABEL[r.associationId]}
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500">
                  {r._count.members} member{r._count.members === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-sm text-gray-400">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={r.discountPercent}
                    onChange={(e) => updateDiscount(r.id, Number(e.target.value))}
                    className="w-16 rounded-lg bg-gray-800 px-3 py-1.5 text-right outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  %
                </label>
                <label className="flex items-center gap-1 text-sm text-gray-400">
                  €
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={(r.discountCents / 100).toFixed(2)}
                    onChange={(e) => updateCents(r.id, Number(e.target.value))}
                    className="w-20 rounded-lg bg-gray-800 px-3 py-1.5 text-right outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </label>
                <label
                  className="flex items-center gap-1.5 text-sm text-gray-400"
                  title="Discount applies to one drink per order (their own); a round for friends is charged normally"
                >
                  <input
                    type="checkbox"
                    checked={r.ownDrinkOnly}
                    onChange={(e) => updateOwnDrinkOnly(r.id, e.target.checked)}
                    className="h-4 w-4 accent-amber-500"
                  />
                  Own drink only
                </label>
                {r.discountPercent >= 100 && <span className="text-xs text-green-400">free</span>}
                <button
                  onClick={() => remove(r)}
                  className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:bg-red-600 hover:text-white"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
