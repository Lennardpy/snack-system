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

// Congressus product used for SSS snack exports.
// "SSS purchases Mendix" — €0.01 per unit, quantity = total cents.
// This matches the export method used by the original Mendix system.
const SSS_MENDIX_PRODUCT_ID = parseInt(
  process.env.CONGRESSUS_PRODUCT_OFFER_ID ?? "118389",
  10
);

// Create a monthly sale invoice in Congressus for a member.
// Uses the "SSS purchases Mendix" product at €0.01 × total_cents — the same
// method as the original Mendix kiosk system.
// Items MUST be included in the initial POST (the API crashes with 500 if
// the items array is omitted, returning no useful error message).
export async function createSaleInvoice(
  memberId: number,
  totalCents: number,
  reference: string
): Promise<number> {
  const res = await fetch(`${BASE}/sale-invoices`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      member_id: memberId,
      invoice_date: new Date().toISOString().split("T")[0],
      invoice_workflow_id: 605,
      use_direct_debit: true,
      invoice_reference: reference,
      // items is required — omitting it causes a 500 instead of a validation error
      items: [
        {
          product_offer_id: SSS_MENDIX_PRODUCT_ID,
          quantity: totalCents,
          price: 0.01,
          description: reference,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Congressus create invoice failed for member ${memberId}: ${res.status} ${await res.text()}`
    );
  }

  const invoice: { id: number } = await res.json();
  return invoice.id;
}
