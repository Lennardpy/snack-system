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
//
// How Congressus products work (discovered via API inspection):
//   GET /products?folder_id=5952 returns "product offer" objects where:
//     id             = product_offer_id  (always equal, 118xxx range)
//     product_id     = underlying product entity ID (110xxx range)
//     product_offer_id = the ID used as product_offer_id in invoice items
//   POST /products returns `id` and `product_offer_id` in the 110xxx range —
//     these are the product entity IDs, NOT the invoice offer IDs. The real
//     offer ID (118xxx) only appears once the product is in the folder listing.
//   GET /products/{id} does NOT work — returns 404 for any ID.
//   PATCH /products/{product_id} uses the product_id from the folder listing.

export interface CongressusFolderProduct {
  id: number;               // same as product_offer_id
  name: string;
  price: number;            // in euros
  product_id: number;       // underlying entity ID — used for PATCH
  product_offer_id: number; // = id — used in invoice line items
  is_archived: boolean;
}

// Fetch all products in the SSS folder from Congressus.
export async function fetchSSSFolderProducts(): Promise<CongressusFolderProduct[]> {
  const res = await fetch(
    `${BASE}/products?folder_id=${SSS_FOLDER_ID}&page_size=100`,
    { headers: headers() }
  );
  if (!res.ok) {
    throw new Error(`Congressus folder fetch failed: ${res.status} ${await res.text()}`);
  }
  const data: { data: CongressusFolderProduct[] } = await res.json();
  return data.data;
}

// Create a product in the SSS folder in Congressus.
// Returns the product_offer_id — used in invoice line items.
//
// NOTE: The POST response returns `id`/`product_offer_id` in the product-entity
// ID range (110xxx), but the actual offer ID used in invoices is a different
// value (118xxx range) that only appears in the folder listing. We therefore
// query the folder after creation to get the real offer ID.
export async function createCongressusProduct(
  name: string,
  priceEuros: number
): Promise<{ offerId: number }> {
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

  // Query the folder to get the real product_offer_id (the POST response id
  // is the product entity ID, not the offer ID used in invoices).
  const folderProducts = await fetchSSSFolderProducts();
  const matches = folderProducts.filter((p) => p.name === name && !p.is_archived);

  if (matches.length === 0) {
    throw new Error(
      `Created Congressus product "${name}" but could not find it in SSS folder`
    );
  }

  // Use the highest offer ID (most recently created)
  const best = matches.reduce((a, b) =>
    a.product_offer_id > b.product_offer_id ? a : b
  );
  return { offerId: best.product_offer_id };
}

// Update a product's name and/or price in Congressus.
// congressusOfferId is the product_offer_id stored locally.
// The PATCH endpoint uses the underlying product_id, so we look that up via the folder.
export async function updateCongressusProduct(
  congressusOfferId: number,
  name: string,
  priceEuros: number
): Promise<void> {
  const folderProducts = await fetchSSSFolderProducts();
  const product = folderProducts.find((p) => p.product_offer_id === congressusOfferId);
  if (!product) {
    throw new Error(`Congressus product with offer ID ${congressusOfferId} not found in SSS folder`);
  }
  const res = await fetch(`${BASE}/products/${product.product_id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ name, price: priceEuros }),
  });
  if (!res.ok) {
    throw new Error(
      `Congressus update product ${product.product_id} failed: ${res.status} ${await res.text()}`
    );
  }
}

// ── Sale Invoices (export) ────────────────────────────────────────────────────

// Congressus product used as a fallback when a product has no offer ID mapped.
// "SSS purchases Mendix" — €0.01 per unit, quantity = total cents.
const SSS_MENDIX_PRODUCT_OFFER_ID = parseInt(
  process.env.CONGRESSUS_PRODUCT_OFFER_ID ?? "118389",
  10
);

export interface InvoiceLineItem {
  productName: string;
  quantity: number;          // number of units (e.g. 3 Colas)
  unitCents: number;         // price per unit in cents
  congressusOfferId: number | null; // null → falls back to SSS Mendix method
}

// Build the Congressus items array from SSS invoice lines.
// For products with a known offer ID: one line per distinct product.
// For products without an offer ID: accumulates into one fallback line.
function buildCongressusItems(
  lines: InvoiceLineItem[],
  reference: string
): { product_offer_id: number; quantity: number; price: number; description: string }[] {
  const items: { product_offer_id: number; quantity: number; price: number; description: string }[] = [];

  let fallbackCents = 0;

  for (const line of lines) {
    if (line.congressusOfferId) {
      items.push({
        product_offer_id: line.congressusOfferId,
        quantity: line.quantity,
        price: line.unitCents / 100,
        description: line.productName,
      });
    } else {
      fallbackCents += line.quantity * line.unitCents;
    }
  }

  if (fallbackCents > 0) {
    items.push({
      product_offer_id: SSS_MENDIX_PRODUCT_OFFER_ID,
      quantity: fallbackCents,
      price: 0.01,
      description: reference,
    });
  }

  // items array must never be empty (Congressus crashes with 500)
  if (items.length === 0) {
    const totalCents = lines.reduce((s, l) => s + l.quantity * l.unitCents, 0);
    items.push({
      product_offer_id: SSS_MENDIX_PRODUCT_OFFER_ID,
      quantity: totalCents,
      price: 0.01,
      description: reference,
    });
  }

  return items;
}

// Create a monthly sale invoice in Congressus for a member.
// Lines with a known Congressus offer ID appear as real products on the invoice.
// Lines without one fall back to "SSS purchases Mendix" at €0.01 × cents.
// Items MUST be included in the initial POST (the API crashes with 500 if omitted).
export async function createSaleInvoice(
  memberId: number,
  lines: InvoiceLineItem[],
  reference: string
): Promise<number> {
  const items = buildCongressusItems(lines, reference);

  const res = await fetch(`${BASE}/sale-invoices`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      member_id: memberId,
      invoice_date: new Date().toISOString().split("T")[0],
      invoice_workflow_id: 605,
      use_direct_debit: true,
      invoice_reference: reference,
      items,
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
