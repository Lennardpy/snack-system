"use client";

import { useEffect, useState } from "react";
import { ASSOCIATION_LABEL, type AssociationId } from "@/lib/associations";
import MemberInvoiceList, { type InvoiceRow } from "@/components/MemberInvoiceList";

// The member portal at ppp.51vo.nl/user: members of Stress and Dimensie log in with
// their association's Congressus and see what they spent, their purchases and
// their invoices (with a PDF each). Read-only. Data: GET /api/user/me.

interface Purchase {
  id: string;
  association: AssociationId;
  where: string;
  at: string;
  totalCents: number;
  billed: boolean;
  lines: { name: string; quantity: number; unitCents: number }[];
}
type Me =
  | { signedIn: false; providers: AssociationId[] }
  | {
      signedIn: true;
      member: { firstName: string; lastName: string; email: string };
      memberships: { association: AssociationId; active: boolean }[];
      unbilledCents: number;
      months: { month: string; cents: number }[];
      purchases: Purchase[];
      invoices: InvoiceRow[];
    };

const LOGO: Record<AssociationId, string> = { stress: "/stress-logo-hex.png", dimensie: "/dimensie-logo.png" };
const ERRORS: Record<string, string> = {
  "not-a-member": "You're not in this association's member list here. Logged in with the right association?",
  expired: "The login took too long or was interrupted — please try again.",
  failed: "Congressus didn't confirm the login — please try again.",
  unavailable: "Logging in with this association isn't available.",
  busy: "Too many attempts — wait a minute and try again.",
};

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const monthName = (ym: string) =>
  new Date(`${ym}-01T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function MemberPortal() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(30);

  useEffect(() => {
    fetch("/api/user/me")
      .then((r) => r.json())
      .then((d: Me) => {
        setError(new URLSearchParams(window.location.search).get("error"));
        setMe(d);
      })
      .catch(() => setMe({ signedIn: false, providers: [] }));
  }, []);

  async function logout() {
    await fetch("/api/user/logout", { method: "POST" });
    window.location.reload();
  }

  if (!me) return <main className="min-h-screen bg-gray-950" />;

  if (!me.signedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 px-4 text-white">
        <div className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-8">
          <h1 className="text-2xl font-bold">Your bar tab</h1>
          <p className="mb-6 mt-1 text-sm text-gray-400">
            See what you drank and bought, and your invoices. Log in with your association&apos;s Congressus account.
          </p>
          {error && <p className="mb-4 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{ERRORS[error] ?? "Login failed."}</p>}
          {me.providers.length === 0 ? (
            <p className="text-sm text-gray-500">Logging in isn&apos;t available yet.</p>
          ) : (
            <div className="space-y-3">
              {me.providers.map((a) => (
                <a
                  key={a}
                  href={`/api/user/oauth/start?association=${a}`}
                  className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 font-semibold text-gray-900 hover:bg-gray-200"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={LOGO[a]} alt="" className="h-8 w-8 object-contain" />
                  Log in with {ASSOCIATION_LABEL[a]}
                </a>
              ))}
            </div>
          )}
        </div>
      </main>
    );
  }

  const dual = me.memberships.length > 1;
  const maxMonth = Math.max(1, ...me.months.map((m) => m.cents));
  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {me.memberships.map((m) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={m.association} src={LOGO[m.association]} alt={ASSOCIATION_LABEL[m.association]} className="h-10 w-10 object-contain" />
            ))}
            <div>
              <h1 className="text-2xl font-bold">
                {me.member.firstName} {me.member.lastName}
              </h1>
              <p className="text-sm text-gray-400">
                {me.member.email} · {me.memberships.map((m) => ASSOCIATION_LABEL[m.association]).join(" & ")}
              </p>
            </div>
          </div>
          <button onClick={logout} className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700">
            Log out
          </button>
        </header>

        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-amber-700/40 bg-amber-900/10 p-5">
            <p className="text-sm text-gray-400">Not invoiced yet</p>
            <p className="text-3xl font-bold tabular-nums">{euro(me.unbilledCents)}</p>
            <p className="mt-1 text-xs text-gray-500">Goes on your next invoice.</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
            <p className="mb-3 text-sm text-gray-400">Spending per month</p>
            {me.months.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {me.months.slice(0, 6).map((m) => (
                  <li key={m.month} className="flex items-center gap-3">
                    <span className="w-32 flex-shrink-0 text-gray-300">{monthName(m.month)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
                      <span className="block h-full rounded-full bg-amber-500" style={{ width: `${(m.cents / maxMonth) * 100}%` }} />
                    </span>
                    <span className="w-16 text-right tabular-nums">{euro(m.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">Invoices</h2>
          <MemberInvoiceList rows={me.invoices} pdfUrl={(key) => `/api/user/invoices/${key}`} showAssociation={dual} />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Purchases</h2>
          {me.purchases.length === 0 ? (
            <p className="text-gray-500">No purchases yet.</p>
          ) : (
            <ul className="space-y-2">
              {me.purchases.slice(0, shown).map((p) => (
                <li key={p.id} className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
                  <div className="flex justify-between gap-3">
                    <p className="font-medium">
                      {p.where}
                      {dual && <span className="ml-2 text-xs text-gray-500">{ASSOCIATION_LABEL[p.association]}</span>}
                    </p>
                    <p className="font-semibold tabular-nums">{euro(p.totalCents)}</p>
                  </div>
                  <p className="text-xs text-gray-500">
                    {when(p.at)} · {p.billed ? "invoiced" : "not invoiced yet"}
                  </p>
                  <p className="mt-1 text-sm text-gray-400">
                    {p.lines.map((l) => `${l.quantity}× ${l.name} (${euro(l.unitCents)})`).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {me.purchases.length > shown && (
            <button onClick={() => setShown((n) => n + 50)} className="mt-3 text-sm text-amber-400 hover:underline">
              Show more
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
