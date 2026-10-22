// Shared confirm + result text for the combined SSS + PPP export (both invoices
// pages trigger the same export: one Congressus invoice per member per export).

export const EXPORT_CONFIRM =
  "Export ALL pending orders — snacks (SSS) and drinks (PPP) together — to Congressus?\n\n" +
  'Each member gets ONE invoice ("SSS & PPP <month>") with all their snacks and drinks — also when the orders span several months.';

// Dimensie's export: only drinks of Dimensie members, to Dimensie's Congressus.
export const DIMENSIE_EXPORT_CONFIRM =
  "Export all pending drink orders of Dimensie members to Dimensie's Congressus?\n\n" +
  'Each member gets ONE invoice ("Borrels <month>") with all their drinks — at Dimensie borrels and joint ' +
  "borrels — without VAT, collected by direct debit. Drinks without a product in Dimensie's Congressus get one first.";

export function exportResultMessage(data: {
  congressusInvoices?: number;
  sssOrders?: number;
  pppOrders?: number;
  failed?: number;
  nothingToPay?: number;
  needsCheck?: number;
  errors?: string[];
  error?: string;
}): string {
  if (data.error) return `Export failed: ${data.error}`;
  let msg =
    `Created ${data.congressusInvoices ?? 0} Congressus invoice(s) covering ` +
    `${data.sssOrders ?? 0} snack and ${data.pppOrders ?? 0} drink order(s).`;
  if (data.nothingToPay) msg += ` ${data.nothingToPay} member(s) only had free (€0) orders — no invoice needed.`;
  if (data.failed) msg += ` ${data.failed} failed.`;
  if (data.errors?.length) msg += `\nErrors:\n${data.errors.join("\n")}`;
  if (data.needsCheck) msg += `\n⚠️ ${data.needsCheck} order(s) need a check in Congressus — see the warning above.`;
  return msg;
}
