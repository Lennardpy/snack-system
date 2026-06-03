// Congressus API v30 client
// Auth: Bearer token via CONGRESSUS_API_TOKEN env var

const BASE = "https://api.congressus.nl/v30";

// Only sync members with these status IDs:
// 1845 = The Primary Membership
// 1844 = The Secondary membership
const ALLOWED_STATUS_IDS = [1845, 1844];

function headers() {
  return {
    Authorization: `Bearer ${process.env.CONGRESSUS_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// ── Members ───────────────────────────────────────────────────────────────────

export interface CongressusMember {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  status: {
    id: number;
    name: string;
    archived: boolean;
    deceased: boolean;
  };
  deleted: boolean;
  locked: boolean;
}

// Fetch all Primary and Secondary members, walking Congressus pagination.
export async function fetchAllMembers(): Promise<CongressusMember[]> {
  const members: CongressusMember[] = [];

  for (const statusId of ALLOWED_STATUS_IDS) {
    let page = 1;

    while (true) {
      const res = await fetch(
        `${BASE}/members?page=${page}&page_size=100&status_id=${statusId}`,
        { headers: headers() }
      );

      if (!res.ok) {
        throw new Error(`Congressus /members failed: ${res.status} ${await res.text()}`);
      }

      const body: {
        data: CongressusMember[];
        has_next: boolean;
        next_num: number;
      } = await res.json();

      members.push(...body.data);
      if (!body.has_next) break;
      page = body.next_num;
    }
  }

  return members;
}

// ── Sale Invoices (export) ────────────────────────────────────────────────────

// The Congressus API requires every invoice line item to reference a
// product_offer_id. We use a single generic "SSS Snack Purchase" product
// created in the SSS product folder (id 5952). The item name and price
// carry the actual purchase detail; the product is just a required anchor.
// Product ID: 118387 ("SSS Snack Purchase" in folder "SSS")
const SSS_PRODUCT_OFFER_ID =
  process.env.CONGRESSUS_PRODUCT_OFFER_ID
    ? parseInt(process.env.CONGRESSUS_PRODUCT_OFFER_ID, 10)
    : 118387;

export interface CreateSaleInvoiceItem {
  name: string;
  description?: string;
  quantity: number;
  price: number; // euros (decimal), e.g. 1.50
}

// Create a sale invoice in Congressus for a member and add line items to it.
// This is what triggers the SEPA deduction.
export async function createSaleInvoice(
  memberId: number,
  items: CreateSaleInvoiceItem[],
  reference?: string
): Promise<number> {
  // Step 1: create the invoice header
  const invoiceRes = await fetch(`${BASE}/sale-invoices`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      member_id: memberId,
      invoice_date: new Date().toISOString().split("T")[0],
      use_direct_debit: true,
      invoice_reference: reference ?? "",
    }),
  });

  if (!invoiceRes.ok) {
    throw new Error(
      `Congressus create invoice failed for member ${memberId}: ${invoiceRes.status} ${await invoiceRes.text()}`
    );
  }

  const invoice: { id: number } = await invoiceRes.json();

  // Step 2: add each line item
  // product_offer_id is required by the Congressus API. We use a single
  // generic SSS product; name + price on the item carry the real detail.
  for (const item of items) {
    const itemRes = await fetch(`${BASE}/sale-invoices/${invoice.id}/items`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        product_offer_id: SSS_PRODUCT_OFFER_ID,
        name: item.name,
        description: item.description ?? "",
        quantity: item.quantity,
        price: item.price,
      }),
    });

    if (!itemRes.ok) {
      throw new Error(
        `Congressus add item failed on invoice ${invoice.id}: ${itemRes.status} ${await itemRes.text()}`
      );
    }
  }

  return invoice.id;
}
