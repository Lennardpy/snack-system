// Congressus API v30 client
// Auth: Bearer token via CONGRESSUS_API_TOKEN env var

const BASE = "https://api.congressus.nl/v30";

// SSS product folder in Congressus (id 5952, name "SSS")
const SSS_FOLDER_ID = 5952;

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

// ── Products ──────────────────────────────────────────────────────────────────

// Create a product in the SSS folder in Congressus.
// Returns the real Congressus product ID.
// NOTE: the POST response returns a stale ID — we verify by querying the folder.
export async function createCongressusProduct(
  name: string,
  priceEuros: number
): Promise<number> {
  const res = await fetch(`${BASE}/products`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      folder_id: SSS_FOLDER_ID,
      name,
      price: priceEuros,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Congressus create product failed: ${res.status} ${await res.text()}`
    );
  }

  const body = await res.json();

  // The POST response may return a stale/wrong ID (known Congressus API bug).
  // Verify by fetching the product directly; fall back to folder search.
  if (body.id) {
    const check = await fetch(`${BASE}/products/${body.id}`, { headers: headers() });
    if (check.ok) return body.id as number;
  }

  // Fallback: search the SSS folder for a product matching the name
  const folderRes = await fetch(
    `${BASE}/products?folder_id=${SSS_FOLDER_ID}&page_size=200`,
    { headers: headers() }
  );
  if (folderRes.ok) {
    const folderData: { data: { id: number; name: string }[] } = await folderRes.json();
    // Match the most recently created product with this name
    const matches = folderData.data.filter((p) => p.name === name);
    if (matches.length > 0) return matches[matches.length - 1].id;
  }

  throw new Error(`Created Congressus product "${name}" but could not determine its ID`);
}

// Update a product's name and/or price in Congressus.
export async function updateCongressusProduct(
  congressusProductId: number,
  name: string,
  priceEuros: number
): Promise<void> {
  const res = await fetch(`${BASE}/products/${congressusProductId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ name, price: priceEuros }),
  });

  if (!res.ok) {
    throw new Error(
      `Congressus update product ${congressusProductId} failed: ${res.status} ${await res.text()}`
    );
  }
}

// ── Sale Invoices (export) ────────────────────────────────────────────────────

export interface CreateSaleInvoiceItem {
  name: string;
  description?: string;
  quantity: number;
  price: number;           // euros (decimal), e.g. 1.50
  productOfferId: number;  // Congressus product_offer_id (required by API)
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
  for (const item of items) {
    const itemRes = await fetch(`${BASE}/sale-invoices/${invoice.id}/items`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        product_offer_id: item.productOfferId,
        name: item.name,
        description: item.description ?? "",
        quantity: item.quantity,
        price: item.price,
      }),
    });

    if (!itemRes.ok) {
      throw new Error(
        `Congressus add item to invoice ${invoice.id} failed: ${itemRes.status} ${await itemRes.text()}`
      );
    }
  }

  return invoice.id;
}
