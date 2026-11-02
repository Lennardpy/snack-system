import ExcelJS from "exceljs";
import { prisma } from "./prisma";
import type { AssociationId } from "./associations";
import { periodLabel } from "./settlement";
import { open } from "./secret-box";

// Export for an association that bills its members itself (Dimensie): instead of
// Congressus sale invoices, one Excel sheet per export with a row per member —
//   First name | Last name | Email | IBAN | BIC | Event | Event price | Student number
// where Event = "Drink costs <period>" and Event price = the member's total.
//
// The export marks the orders EXPORTED and ties them to a PppExportBatch in one
// transaction (nothing external is called, so there's no "needs a check" case).
// The sheet itself is built when it's downloaded, from the batch's orders and the
// members' encrypted bank details — so IBANs are never stored anywhere else.

// Orders the monthly run may bill: at borrels held before the cut-off (the 1st of
// the month) that are closed — a borrel still open waits for the next month.
export function pppCutoffWhere(cutoff: Date | null) {
  return cutoff ? { activity: { date: { lt: cutoff }, status: "CLOSED" as const } } : {};
}

const PREFIX: Record<AssociationId, string> = { stress: "STRESS-EXP", dimensie: "DIM-EXP" };

export class SheetExportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// Bills every unbilled (CONFIRMED) order of this association's members — with a
// `cutoff` (monthly run) only those at closed borrels held before it. null when
// there's nothing to export.
export async function createSheetExport(association: AssociationId, userId: string | null, cutoff: Date | null = null) {
  return prisma.$transaction(async (tx) => {
    const orders = await tx.pppInvoice.findMany({
      where: { status: "CONFIRMED", member: { associationId: association }, ...pppCutoffWhere(cutoff) },
      select: { id: true, memberId: true, totalCents: true, activity: { select: { date: true } } },
    });
    if (orders.length === 0) return null;

    const year = new Date().getFullYear();
    const prefix = `${PREFIX[association]}-${year}-`;
    const last = await tx.pppExportBatch.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const next = (last ? parseInt(last.number.slice(prefix.length), 10) : 0) + 1;
    const owing = new Set(orders.filter((o) => o.totalCents > 0).map((o) => o.memberId));
    const batch = await tx.pppExportBatch.create({
      data: {
        number: `${prefix}${String(next).padStart(3, "0")}`,
        associationId: association,
        period: periodLabel(orders.map((o) => o.activity.date)),
        members: owing.size,
        totalCents: orders.reduce((s, o) => s + o.totalCents, 0),
        createdById: userId,
      },
    });
    // Only rows still CONFIRMED: a concurrent export or edit makes the count differ
    // and rolls the whole thing back.
    const { count } = await tx.pppInvoice.updateMany({
      where: { id: { in: orders.map((o) => o.id) }, status: "CONFIRMED" },
      data: { status: "EXPORTED", exportedAt: new Date(), exportBatchId: batch.id },
    });
    if (count !== orders.length) throw new SheetExportError("Orders changed during the export — try again.", 409);
    return batch;
  });
}

export interface SheetRow {
  firstName: string;
  lastName: string;
  email: string;
  iban: string | null;
  bic: string | null;
  studentNumber: string | null;
  totalCents: number;
}

// One row per member with something to pay, sorted by last name.
export async function sheetRows(batchId: string): Promise<SheetRow[]> {
  const orders = await prisma.pppInvoice.findMany({
    where: { exportBatchId: batchId },
    select: {
      memberId: true,
      totalCents: true,
      member: { select: { firstName: true, lastName: true, email: true, ibanEnc: true, bicEnc: true, studentNumber: true } },
    },
  });
  const rows = new Map<string, SheetRow>();
  for (const o of orders) {
    const row = rows.get(o.memberId) ?? {
      firstName: o.member.firstName,
      lastName: o.member.lastName,
      email: o.member.email,
      iban: open(o.member.ibanEnc),
      bic: open(o.member.bicEnc),
      studentNumber: o.member.studentNumber,
      totalCents: 0,
    };
    row.totalCents += o.totalCents;
    rows.set(o.memberId, row);
  }
  return [...rows.values()]
    .filter((r) => r.totalCents > 0)
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
}

export async function renderSheet(batch: { number: string; period: string }, rows: SheetRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Stress PPP";
  const ws = wb.addWorksheet(batch.number);
  ws.columns = [
    { header: "First Name", key: "firstName", width: 18 },
    { header: "Last Name", key: "lastName", width: 22 },
    { header: "Email", key: "email", width: 32 },
    { header: "IBAN", key: "iban", width: 24 },
    { header: "BIC", key: "bic", width: 13 },
    { header: "Event", key: "event", width: 28 },
    { header: "Event price", key: "price", width: 12, style: { numFmt: "0.00" } },
    { header: "Student number", key: "studentNumber", width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) {
    ws.addRow({
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      iban: r.iban ?? "",
      bic: r.bic ?? "",
      event: `Drink costs ${batch.period}`,
      price: r.totalCents / 100,
      studentNumber: r.studentNumber ?? "",
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
