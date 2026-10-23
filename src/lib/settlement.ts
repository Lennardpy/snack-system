import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { externalBreakdown, VAT_RATE, type ExternalBreakdown } from "./external";

// Stress's monthly invoice to Dimensie (see AssociationSettlement in the schema).
//
// What's on it: every order of a DIMENSIE member at a borrel STRESS hosts (the
// joint Thursday drink) that isn't on an earlier invoice yet, with the borrel in
// or before the month — so orders added after a month was invoiced roll onto the
// next one. Per line:
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
  month: string;
  monthLabel: string;
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

// "2026-10" → its first moment in Amsterdam time, as a UTC Date.
function amsterdamMonthStart(year: number, month: number): Date {
  const utcMidnight = new Date(Date.UTC(year, month - 1, 1, 0, 0));
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", hourCycle: "h23" }).format(utcMidnight)
  );
  return new Date(utcMidnight.getTime() - hour * 3600_000);
}

export function isMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function monthEnd(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? amsterdamMonthStart(y + 1, 1) : amsterdamMonthStart(y, m + 1);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function previousMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit" }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

// The orders a month's invoice would cover (not on an invoice yet).
export function candidateWhere(month: string): Prisma.PppInvoiceWhereInput {
  return {
    settlementId: null,
    member: { associationId: SETTLEMENT_DEBTOR },
    activity: { associationId: SETTLEMENT_CREDITOR, date: { lt: monthEnd(month) } },
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

export function buildSnapshot(month: string, orders: Order[]): SettlementSnapshot {
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
    month,
    monthLabel: monthLabel(month),
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

// The live (draft) invoice for a month.
export async function draftSettlement(month: string) {
  const orders = await prisma.pppInvoice.findMany({
    where: candidateWhere(month),
    select: orderSelect,
    orderBy: { confirmedAt: "asc" },
  });
  return { orderIds: orders.map((o) => o.id), snapshot: buildSnapshot(month, orders) };
}

export const settlementNumber = (month: string) => `STRESS-DIM-${month}`;

// Finalise a month: freeze the figures and lock the orders, atomically. The
// candidate orders are re-read inside the transaction, so an order confirmed in
// the meantime is either on it (and locked) or left for next month.
export async function finalizeSettlement(month: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const orders = await tx.pppInvoice.findMany({
      where: candidateWhere(month),
      select: orderSelect,
      orderBy: { confirmedAt: "asc" },
    });
    if (orders.length === 0) throw new SettlementError("Nothing to invoice for this month.", 409);
    if (await tx.associationSettlement.findUnique({ where: { debtorId_month: { debtorId: SETTLEMENT_DEBTOR, month } } })) {
      throw new SettlementError("This month already has an invoice.", 409);
    }
    const snapshot = buildSnapshot(month, orders);
    const settlement = await tx.associationSettlement.create({
      data: {
        number: settlementNumber(month),
        month,
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
    if (count !== orders.length) throw new SettlementError("Orders changed while finalising — try again.", 409);
    return settlement;
  });
}

export class SettlementError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
