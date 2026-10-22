"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatRoleDiscount } from "@/lib/roles";
import { ASSOCIATION_IDS, ASSOCIATION_LABEL, type AssociationId } from "@/lib/associations";

interface Role {
  id: string;
  associationId: AssociationId;
  name: string;
  discountPercent: number;
  discountCents: number;
  color: string | null;
}

interface Member {
  id: string;
  associationId: AssociationId;
  congressusId: number;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
  cards: { uid: string; name: string | null }[];
  roles: Role[];
}

function RoleChip({ role }: { role: Role }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
      style={
        role.color
          ? { borderColor: role.color, color: role.color }
          : { borderColor: "#9333ea66", color: "#c4b5fd" }
      }
    >
      {role.name}
      <span className="opacity-70">{formatRoleDiscount(role)}</span>
    </span>
  );
}

// The members list of an admin site. Members and cards are shared by both systems,
// each site shows its part: the SSS admin manages Stress members for the snack
// kiosk (Enter store, member dashboard); the PPP admin manages the members of its
// association(s) and their roles (bar discounts). The API scopes the list.
export default function MembersView({ site }: { site: "sss" | "ppp" }) {
  const router = useRouter();
  const ppp = site === "ppp";
  const [members, setMembers] = useState<Member[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [syncing, setSyncing] = useState<AssociationId | null>(null);
  const [association, setAssociation] = useState<AssociationId | "all">("all");
  // The associations this login manages (from the API): their sync buttons/filters.
  const [associations, setAssociations] = useState<AssociationId[]>([]);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingRoles, setSavingRoles] = useState(false);

  function load() {
    fetch("/api/admin/members")
      .then((r) => r.json())
      .then((d) => {
        setMembers(d.members ?? []);
        setAssociations(d.associations ?? []);
      });
  }
  function loadRoles() {
    fetch("/api/admin/ppp/roles")
      .then((r) => r.json())
      .then((d) => setAllRoles(d.roles ?? []));
  }

  useEffect(() => {
    load();
    if (ppp) loadRoles();
  }, [ppp]);

  async function sync(which: AssociationId) {
    setSyncing(which);
    setSyncResult(null);
    const res = await fetch("/api/admin/members/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ association: which }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSyncResult(`${ASSOCIATION_LABEL[which]} sync failed: ${data.error ?? res.status}`);
      setSyncing(null);
      return;
    }
    const parts = [
      `${ASSOCIATION_LABEL[which]} sync complete: ${data.created} created, ${data.updated} updated (${data.total} in Congressus).`,
      data.pruneSkipped
        ? data.pruneSkipped
        : `No longer in Congressus: ${data.deleted} removed, ${data.deactivated} deactivated (kept for their purchase history).`,
    ];
    if (data.cardsMoved) {
      parts.push(`${data.cardsMoved} card(s) moved to the member's other membership (same person, other association).`);
    }
    if (data.openInvoices?.length) {
      parts.push(
        `Still to invoice: ${data.openInvoices
          .map((o: { name: string; openCents: number }) => `${o.name} €${(o.openCents / 100).toFixed(2)}`)
          .join(", ")}.`
      );
    }
    setSyncResult(parts.join(" "));
    setSyncing(null);
    load();
  }

  async function enterStore(m: Member) {
    setBusyId(m.id);
    const res = await fetch(`/api/admin/members/${m.id}/shop`, { method: "POST" });
    const data = await res.json();
    setBusyId(null);
    if (res.ok && data.token) {
      router.push(`/shop/${data.token}`);
    } else {
      alert(data.error ?? "Could not open the store for this member.");
    }
  }

  async function remove(m: Member) {
    if (
      !confirm(
        `Delete ${m.firstName} ${m.lastName}?\n\nTheir cards, roles and personal details are removed. ` +
          `Past (exported) purchases are kept anonymously as "Deleted member", so revenue figures stay correct. ` +
          `Only possible when nothing is left to bill. This cannot be undone.`
      )
    )
      return;
    setBusyId(m.id);
    const res = await fetch(`/api/admin/members/${m.id}`, { method: "DELETE" });
    const data = await res.json();
    setBusyId(null);
    if (res.ok) {
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
    } else {
      alert(data.error ?? "Could not delete member.");
    }
  }

  async function toggleRole(member: Member, roleId: string) {
    const has = member.roles.some((r) => r.id === roleId);
    const nextIds = has
      ? member.roles.filter((r) => r.id !== roleId).map((r) => r.id)
      : [...member.roles.map((r) => r.id), roleId];
    setSavingRoles(true);
    const res = await fetch(`/api/admin/members/${member.id}/roles`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleIds: nextIds }),
    });
    setSavingRoles(false);
    if (res.ok) {
      const { roles } = await res.json();
      setMembers((prev) => prev.map((x) => (x.id === member.id ? { ...x, roles } : x)));
    }
  }

  const filtered = members.filter(
    (m) =>
      (association === "all" || m.associationId === association) &&
      `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(search.toLowerCase())
  );
  const count = (a: AssociationId) => members.filter((m) => m.associationId === a).length;

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Members</h1>
          <p className="text-gray-500">{members.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          {ppp && (
            <Link
              href="/ppp/admin/roles"
              className="rounded-xl border border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800"
            >
              🎟️ Manage roles
            </Link>
          )}
          {associations.map((a) => (
            <button
              key={a}
              onClick={() => sync(a)}
              disabled={syncing !== null}
              className="rounded-xl bg-blue-600 px-5 py-2.5 font-semibold transition-colors hover:bg-blue-500 disabled:opacity-40"
            >
              {syncing === a ? "Syncing…" : `Sync ${ASSOCIATION_LABEL[a]}`}
            </button>
          ))}
        </div>
      </div>

      {syncResult && (
        <p className="mb-4 rounded-lg bg-blue-900/30 px-4 py-2 text-blue-300">{syncResult}</p>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md rounded-xl bg-gray-800 px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
        />
        {associations.length > 1 && (
          <div className="flex gap-1 rounded-xl bg-gray-900 p-1">
            {(["all", ...ASSOCIATION_IDS] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAssociation(a)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  association === a ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                {a === "all" ? `All (${members.length})` : `${ASSOCIATION_LABEL[a]} (${count(a)})`}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {filtered.map((m) => (
          <div key={m.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-sm font-bold">
                  {m.firstName[0]}{m.lastName[0]}
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold">
                    <a href={`${ppp ? "/ppp/admin" : "/admin"}/members/${m.id}`} className="truncate hover:text-blue-400 hover:underline">
                      {m.firstName} {m.lastName}
                    </a>
                    {m.associationId !== "stress" && (
                      <span className="flex-shrink-0 rounded-full bg-teal-900/50 px-2 py-0.5 text-xs text-teal-300">
                        {ASSOCIATION_LABEL[m.associationId]}
                      </span>
                    )}
                    {!m.active && (
                      <span className="flex-shrink-0 rounded-full bg-red-900/50 px-2 py-0.5 text-xs text-red-300">Inactive</span>
                    )}
                  </p>
                  <p className="truncate text-sm text-gray-400">{m.email}</p>
                  <p className="text-xs text-gray-600">{m.cards.length} card(s) linked</p>
                </div>
              </div>

              <div className="flex flex-shrink-0 items-center gap-2">
                {!ppp && (
                  <a
                    href={`${ppp ? "/ppp/admin" : "/admin"}/members/${m.id}`}
                    title="Purchases, spend, open invoice and cards (unlink a lost card)"
                    className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-blue-600"
                  >
                    📊 Dashboard
                  </a>
                )}
                {ppp && (
                  <button
                    onClick={() => setEditingId(editingId === m.id ? null : m.id)}
                    title="Assign roles / discounts"
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      editingId === m.id ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-200 hover:bg-amber-600"
                    }`}
                  >
                    🎟️ Roles
                  </button>
                )}
                {!ppp && m.associationId === "stress" && (
                  <button
                    onClick={() => enterStore(m)}
                    disabled={busyId === m.id}
                    title="Open the kiosk shop as this member"
                    className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-blue-600 disabled:opacity-40"
                  >
                    🛒 Enter store
                  </button>
                )}
                <button
                  onClick={() => remove(m)}
                  disabled={busyId === m.id}
                  title="Delete member"
                  className="rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-gray-400 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Current role chips */}
            {m.roles.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 pl-14">
                {m.roles.map((r) => (
                  <RoleChip key={r.id} role={r} />
                ))}
              </div>
            )}

            {/* Inline role editor */}
            {editingId === m.id && (
              <div className="mt-3 rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                {allRoles.filter((role) => role.associationId === m.associationId).length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No roles defined yet.{" "}
                    <Link href="/ppp/admin/roles" className="text-amber-400 underline">
                      Create roles
                    </Link>{" "}
                    first.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {allRoles.filter((role) => role.associationId === m.associationId).map((role) => {
                      const active = m.roles.some((r) => r.id === role.id);
                      return (
                        <button
                          key={role.id}
                          onClick={() => toggleRole(m, role.id)}
                          disabled={savingRoles}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
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
                )}
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && <p className="text-gray-500">No members found.</p>}
      </div>
    </div>
  );
}
