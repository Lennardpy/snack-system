import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { externalBreakdown, VAT_RATE, type ExternalBreakdown } from "./external";

// Stress's specification to Dimensie (see AssociationSettlement in the schema),
// created by each Dimensie export (or by hand on the Stress side).
//
// What's on it: every order of a DIMENSIE member at a borrel STRESS hosts (the
// joint Thursday drink) that Dimensie has billed (EXPORTED to its Congressus) and
// that isn't on an earlier specification — so Stress specifies exactly what
// Dimensie billed its members; orders still pending wait for a later export. Per line:
//   • price = the drink's price BEFORE role discounts (Wall Street price, borrel
//     special, drink special or list price — the line's baseCents snapshot):
//     Dimensie covers its own members' discounts;
//   • bartender free drinks are left out — Stress covers its bartenders' drinks,
//     also Dimensie bartenders' at a joint borrel;
//   • VAT at the line's snapshot rate (incl. VAT; excl. and VAT are backed out).

export const SETTLEMENT_DEBTOR = "dimensie";

export const SETTLEMENT_CREDITOR = "stress";

export interface SettlementMemberLine {
  name: string;
  quantity: number;
  unitInclCents: number;
  totalInclCents: number;
}
// One purchase on the specification (an order line).
export interface SettlementPurchase {
  date: string; // borrel date (ISO)
  borrel: string;
  member: string;
  congressusId: number | null;
  drink: string;
  quantity: number;
  unitInclCents: number;
  vatRate: number;
  totalInclCents: number;
}
export interface SettlementSnapshot {
  periodLabel: string; // e.g. "October 2026" / "September – October 2026"
  monthLabel?: string; // the same, on specifications made before they were per export
  orders: number;
  breakdown: ExternalBreakdown; // per drink + VAT per rate + totals
  members: { name: string; congressusId: number | null; lines: SettlementMemberLine[]; totalInclCents: number }[];
  borrels: { name: string; date: string; drinks: number; totalInclCents: number }[];
  // Every purchase, by borrel date then member (absent on early snapshots).
  purchases?: SettlementPurchase[];
  // What Dimensie members were actually charged (after Dimensie's role
  // discounts) — for Dimensie's information; the invoice uses the prices above.
  chargedToMembersCents: number;
}

// "October 2026", or "September – October 2026" for borrels spanning months.
export function periodLabel(dates: Date[]): string {
  if (dates.length === 0) return "";
  const fmt = (d: Date, withYear = true) =>
    d.toLocaleString("en-GB", { month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: "Europe/Amsterdam" });
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (fmt(first) === fmt(last)) return fmt(first);
  const sameYear = first.toLocaleString("en-GB", { year: "numeric", timeZone: "Europe/Amsterdam" }) ===
    last.toLocaleString("en-GB", { year: "numeric", timeZone: "Europe/Amsterdam" });
  return `${fmt(first, !sameYear)} – ${fmt(last)}`;
}

// Dimensie members' orders at Stress borrels not on a specification yet. With
// `exportedOnly`: just those Dimensie has billed — what a specification covers.
export function pendingWhere(exportedOnly: boolean): Prisma.PppInvoiceWhereInput {
  return {
    settlementId: null,
    member: { associationId: SETTLEMENT_DEBTOR },
    activity: { associationId: SETTLEMENT_CREDITOR },
    ...(exportedOnly ? { status: "EXPORTED" as const } : {}),
  };
}

const orderSelect = {
  id: true,
  totalCents: true,
  member: { select: { firstName: true, lastName: true, congressusId: true } },
  activity: { select: { id: true, name: true, date: true } },
  lines: {
    select: {
      quantity: true,
      unitCents: true,
      baseCents: true,
      listCents: true,
      specialCents: true,
      vatRate: true,
      bartenderFree: true,
      product: { select: { id: true, name: true, price: true, specialPrice: true, vatCategory: true } },
    },
  },
} satisfies Prisma.PppInvoiceSelect;

type Order = Prisma.PppInvoiceGetPayload<{ select: typeof orderSelect }>;
type Line = Order["lines"][number];

// Price before role discounts. Lines from before the snapshot existed fall back
// to the special that applied, else the list price.
const basePrice = (l: Line) => l.baseCents ?? l.specialCents ?? l.product.specialPrice ?? l.listCents ?? l.product.price;
const vatOf = (l: Line) => l.vatRate ?? VAT_RATE[l.product.vatCategory];

export function buildSnapshot(orders: Order[]): SettlementSnapshot {
  const billable = orders.flatMap((o) => o.lines.filter((l) => !l.bartenderFree).map((l) => ({ o, l })));
  const breakdown = externalBreakdown(
    billable.map(({ l }) => ({
      productId: l.product.id,
      name: l.product.name,
      quantity: l.quantity,
      unitCents: basePrice(l),
      vatRate: vatOf(l),
    })),
    "INTERNAL"
  );

  const purchases: SettlementPurchase[] = billable.map(({ o, l }) => ({
    date: o.activity.date.toISOString(),
    borrel: o.activity.name,
    member: `${o.member.firstName} ${o.member.lastName}`.trim(),
    congressusId: o.member.congressusId,
    drink: l.product.name,
    quantity: l.quantity,
    unitInclCents: basePrice(l),
    vatRate: vatOf(l),
    totalInclCents: basePrice(l) * l.quantity,
  }));
  purchases.sort((a, b) => a.date.localeCompare(b.date) || a.borrel.localeCompare(b.borrel) || a.member.localeCompare(b.member));

  const members = new Map<string, SettlementSnapshot["members"][number]>();
  const borrels = new Map<string, SettlementSnapshot["borrels"][number]>();
  for (const { o, l } of billable) {
    const name = `${o.member.firstName} ${o.member.lastName}`.trim();
    const key = `${o.member.congressusId ?? ""}|${name}`;
    const m = members.get(key) ?? { name, congressusId: o.member.congressusId, lines: [], totalInclCents: 0 };
    const unit = basePrice(l);
    const line = m.lines.find((x) => x.name === l.product.name && x.unitInclCents === unit);
    if (line) {
      line.quantity += l.quantity;
      line.totalInclCents += unit * l.quantity;
    } else m.lines.push({ name: l.product.name, quantity: l.quantity, unitInclCents: unit, totalInclCents: unit * l.quantity });
    m.totalInclCents += unit * l.quantity;
    members.set(key, m);

    const b = borrels.get(o.activity.id) ?? { name: o.activity.name, date: o.activity.date.toISOString(), drinks: 0, totalInclCents: 0 };
    b.drinks += l.quantity;
    b.totalInclCents += unit * l.quantity;
    borrels.set(o.activity.id, b);
  }

  return {
    periodLabel: periodLabel(orders.map((o) => o.activity.date)),
    orders: orders.length,
    breakdown,
    members: [...members.values()]
      .map((m) => ({ ...m, lines: m.lines.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    borrels: [...borrels.values()].sort((a, b) => a.date.localeCompare(b.date)),
    purchases,
    chargedToMembersCents: orders.reduce((s, o) => s + o.totalCents, 0),
  };
}

// What's waiting for the next specification: the billed orders it will cover,
// and how many orders are still pending in Dimensie's export.
export async function pendingSettlement() {
  const [orders, notExported] = await Promise.all([
    prisma.pppInvoice.findMany({ where: pendingWhere(true), select: orderSelect, orderBy: { confirmedAt: "asc" } }),
    prisma.pppInvoice.count({ where: { ...pendingWhere(false), status: { not: "EXPORTED" } } }),
  ]);
  return { snapshot: buildSnapshot(orders), notExported };
}

// Create the next specification from every billed, not-yet-specified order —
// called after each Dimensie export (and by the "create now" button). Freezes the
// figures and locks the orders, atomically; null when there's nothing to specify.
export async function createSettlement(userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const orders = await tx.pppInvoice.findMany({ where: pendingWhere(true), select: orderSelect, orderBy: { confirmedAt: "asc" } });
    if (orders.length === 0) return null;
    const snapshot = buildSnapshot(orders);
    // STRESS-DIM-<year>-<001…>, numbered per calendar year of creation.
    const year = new Date().getFullYear();
    const prefix = `STRESS-DIM-${year}-`;
    const last = await tx.associationSettlement.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const next = (last ? parseInt(last.number.slice(prefix.length), 10) : 0) + 1;
    const settlement = await tx.associationSettlement.create({
      data: {
        number: `${prefix}${String(next).padStart(3, "0")}`,
        period: snapshot.periodLabel,
        debtorId: SETTLEMENT_DEBTOR,
        creditorId: SETTLEMENT_CREDITOR,
        totalExclCents: snapshot.breakdown.totalExclCents,
        totalVatCents: snapshot.breakdown.totalVatCents,
        totalInclCents: snapshot.breakdown.totalInclCents,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    const { count } = await tx.pppInvoice.updateMany({
      where: { id: { in: orders.map((o) => o.id) }, settlementId: null },
      data: { settlementId: settlement.id },
    });
    if (count !== orders.length) throw new SettlementError("Orders changed while creating the specification — try again.", 409);
    return settlement;
  });
}

export class SettlementError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
