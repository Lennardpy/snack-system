// Shared confirm + result text for the combined SSS + PPP export (both invoices
// pages trigger the same export: one Congressus invoice per member per export).

export const EXPORT_CONFIRM =
  "Export ALL pending orders — snacks (SSS) and drinks (PPP) together — to Congressus?\n\n" +
  'Each member gets ONE invoice ("SSS & PPP <month>") with all their snacks and drinks — also when the orders span several months.';

// Dimensie's export: drinks of Dimensie members, as an Excel sheet (Dimensie
// collects from its members itself).
export const DIMENSIE_EXPORT_CONFIRM =
  "Export all pending drink orders of Dimensie members to an Excel sheet?\n\n" +
  "One row per member (name, email, IBAN, BIC, student number) with their total for the period — drinks at " +
  "Dimensie borrels and joint borrels, without VAT. The orders are marked exported; the sheet downloads right away " +
  "and stays available under Dimensie exports.";

export function exportResultMessage(data: {
  congressusInvoices?: number;
  sssOrders?: number;
  pppOrders?: number;
  failed?: number;
  nothingToPay?: number;
  needsCheck?: number;
  specification?: string | null;
  errors?: string[];
  error?: string;
}): string {
  if (data.error) return `Export failed: ${data.error}`;
  let msg =
    `Created ${data.congressusInvoices ?? 0} Congressus invoice(s) covering ` +
    `${data.sssOrders ?? 0} snack and ${data.pppOrders ?? 0} drink order(s).`;
  if (data.nothingToPay) msg += ` ${data.nothingToPay} member(s) only had free (€0) orders — no invoice needed.`;
  if (data.specification) msg += ` Specification ${data.specification} for Stress was created.`;
  if (data.failed) msg += ` ${data.failed} failed.`;
  if (data.errors?.length) msg += `\nErrors:\n${data.errors.join("\n")}`;
  if (data.needsCheck) msg += `\n⚠️ ${data.needsCheck} order(s) need a check in Congressus — see the warning above.`;
  return msg;
}

export function sheetExportMessage(data: {
  sheet?: { number: string; members: number; totalCents: number } | null;
  exported?: number;
  specification?: string | null;
  errors?: string[];
  error?: string;
}): string {
  if (data.error) return `Export failed: ${data.error}`;
  if (!data.sheet) return "Nothing to export — no pending Dimensie orders.";
  let msg =
    `Exported ${data.exported ?? 0} order(s) to ${data.sheet.number}: ${data.sheet.members} member(s), ` +
    `€${(data.sheet.totalCents / 100).toFixed(2)} in total.`;
  if (data.specification) msg += ` Specification ${data.specification} for Stress was created.`;
  if (data.errors?.length) msg += `\nErrors:\n${data.errors.join("\n")}`;
  return msg;
}
