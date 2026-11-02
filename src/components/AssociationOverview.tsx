"use client";

import { useEffect, useState } from "react";
import { ASSOCIATION_LABEL, type AssociationId } from "@/lib/associations";

// The top of the PPP dashboard: per association the login manages, where things
// stand right now — members and cards, upcoming borrels, what's still to bill,
// the last export and the specifications between Stress and Dimensie.
// (GET /api/admin/ppp/overview)

interface Spec {
  number: string;
  period: string;
  status: "FINAL" | "SENT";
  totalInclCents: number;
  createdAt: string;
  sentAt: string | null;
}
interface Overview {
  association: AssociationId;
  billsFromSheet: boolean;
  members: { active: number; withCard: number; withoutIban: number | null };
  borrels: {
    upcoming: { id: string; name: string; date: string; joint: boolean; hostedByOther: boolean }[];
    lastMonth: number;
  };
  unbilled: { cents: number; orders: number; members: number; needsCheck: number };
  lastExport: { at: string; label: string } | null;
  specifications:
    | { toSend: number; toSendCents: number; latest: Spec | null }
    | { received: number; latest: Spec | null };
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export default function AssociationOverview() {
  const [data, setData] = useState<Overview[] | null>(null);
  useEffect(() => {
    fetch("/api/admin/ppp/overview")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d?.associations ?? []));
  }, []);
  if (!data) return null;

  return (
    <div className={`mb-8 grid gap-6 ${data.length > 1 ? "xl:grid-cols-2" : ""}`}>
      {data.map((o) => (
        <section key={o.association} className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <h2 className="mb-4 text-lg font-semibold">{ASSOCIATION_LABEL[o.association]} — now</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm 2xl:grid-cols-4">
            <Fact label="Members" value={String(o.members.active)} sub={`${o.members.withCard} with a card`} href="/ppp/admin/members" />
            <Fact
              label="Still to bill"
              value={euro(o.unbilled.cents)}
              sub={`${o.unbilled.orders} order(s) · ${o.unbilled.members} member(s)`}
              warn={o.unbilled.needsCheck > 0 ? `${o.unbilled.needsCheck} need a check` : undefined}
              href="/ppp/admin/invoices"
            />
            <Fact
              label="Last export"
              value={o.lastExport ? day(o.lastExport.at) : "never"}
              sub={o.lastExport?.label}
            />
            {"toSend" in o.specifications ? (
              <Fact
                label="Specifications to Dimensie"
                value={o.specifications.toSend > 0 ? `${o.specifications.toSend} to send` : "all sent"}
                sub={o.specifications.toSend > 0 ? euro(o.specifications.toSendCents) : o.specifications.latest?.number}
                href="/ppp/admin/settlements"
              />
            ) : (
              <Fact
                label="Latest from Stress"
                value={o.specifications.latest ? euro(o.specifications.latest.totalInclCents) : "none yet"}
                sub={o.specifications.latest ? `${o.specifications.latest.number} · ${o.specifications.latest.period}` : undefined}
                href="/ppp/admin/settlements"
              />
            )}
          </div>
          {o.members.withoutIban != null && o.members.withoutIban > 0 && (
            <p className="mt-4 text-sm text-amber-400">
              ⚠ {o.members.withoutIban} active member(s) without an IBAN — they show up without bank details in the export sheet.
            </p>
          )}
          <div className="mt-5">
            <p className="mb-2 text-sm text-gray-400">
              Upcoming borrels <span className="text-gray-600">· {o.borrels.lastMonth} in the last 30 days</span>
            </p>
            {o.borrels.upcoming.length === 0 ? (
              <p className="text-sm text-gray-500">None planned.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {o.borrels.upcoming.map((b) => (
                  <li key={b.id} className="flex justify-between gap-3">
                    <a href={`/ppp/admin/activities/${b.id}`} className="truncate hover:underline">
                      {b.name}
                      {b.joint && <span className="ml-2 rounded-full bg-teal-500/15 px-2 py-0.5 text-xs text-teal-300">joint</span>}
                    </a>
                    <span className="flex-shrink-0 text-gray-500">{day(b.date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function Fact({ label, value, sub, warn, href }: { label: string; value: string; sub?: string; warn?: string; href?: string }) {
  const body = (
    <>
      <p className="text-gray-400">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
      {warn && <p className="text-xs text-amber-400">⚠ {warn}</p>}
    </>
  );
  return href ? (
    <a href={href} className="block rounded-lg hover:bg-gray-800/40">
      {body}
    </a>
  ) : (
    <div>{body}</div>
  );
}
