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

export interface CongressusProductIds {
  productId: number;
  offerId: number | null; // null if Congressus didn't return an offer
}

// Create a product in the SSS folder in Congressus.
// Returns both the real product ID and the offer ID (needed for invoice line items).
// NOTE: the POST response returns a stale ID — we verify by querying the folder.
export async function createCongressusProduct(
  name: string,
  priceEuros: number
): Promise<CongressusProductIds> {
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
  // Verify by fetching the product directly; this also gives us the offer ID.
  let productId: number | null = null;

  if (body.id) {
    const check = await fetch(`${BASE}/products/${body.id}`, { headers: headers() });
    if (check.ok) {
      productId = body.id as number;
      const productData = await check.json();
      const offerId = extractOfferId(productData);
      return { productId, offerId };
    }
  }

  // Fallback: search the SSS folder for a product matching the name
  const folderRes = await fetch(
    `${BASE}/products?folder_id=${SSS_FOLDER_ID}&page_size=200`,
    { headers: headers() }
  );
  if (folderRes.ok) {
    const folderData: { data: CongressusProductDetail[] } = await folderRes.json();
    const matches = folderData.data.filter((p) => p.name === name);
    if (matches.length > 0) {
      const p = matches[matches.length - 1];
      return { productId: p.id, offerId: extractOfferId(p) };
    }
  }

  throw new Error(`Created Congressus product "${name}" but could not determine its ID`);
}

interface CongressusProductDetail {
  id: number;
  name: string;
  // Congressus may nest the offer under different keys depending on API version
  offer?: { id: number };
  offers?: { id: number }[];
  product_offer?: { id: number };
  product_offers?: { id: number }[];
  offer_id?: number;
  product_offer_id?: number;
}

function extractOfferId(product: CongressusProductDetail): number | null {
  if (product.offer?.id) return product.offer.id;
  if (product.offers?.[0]?.id) return product.offers[0].id;
  if (product.product_offer?.id) return product.product_offer.id;
  if (product.product_offers?.[0]?.id) return product.product_offers[0].id;
  if (product.offer_id) return product.offer_id;
  if (product.product_offer_id) return product.product_offer_id;
  return null;
}

// Fetch the offer ID for an already-existing Congressus product.
// Used to backfill congressusProductOfferId for products created before this feature.
export async function fetchCongressusProductOfferId(
  productId: number
): Promise<number | null> {
  const res = await fetch(`${BASE}/products/${productId}`, { headers: headers() });
  if (!res.ok) return null;
  const data: CongressusProductDetail = await res.json();
  return extractOfferId(data);
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

// Congressus product used as a fallback when a product has no offer ID mapped.
// "SSS purchases Mendix" — €0.01 per unit, quantity = total cents.
const SSS_MENDIX_PRODUCT_OFFER_ID = parseInt(
  process.env.CONGRESSUS_PRODUCT_OFFER_ID ?? "118389",
  10
);

export interface InvoiceLineItem {
  productName: string;
  quantity: number;       // number of units (e.g. 3 Colas)
  unitCents: number;      // price per unit in cents
  congressusOfferId: number | null; // null → will use fallback
}

// Build the Congressus items array from SSS invoice lines.
// For products with a known offer ID: one line per distinct product.
// For products without an offer ID: falls back to "SSS purchases Mendix" at €0.01 × cents.
function buildCongressusItems(
  lines: InvoiceLineItem[],
  reference: string
): { product_offer_id: number; quantity: number; price: number; description: string }[] {
  const items: { product_offer_id: number; quantity: number; price: number; description: string }[] = [];

  let fallbackCents = 0;

  for (const line of lines) {
    const lineCents = line.quantity * line.unitCents;
    if (line.congressusOfferId) {
      items.push({
        product_offer_id: line.congressusOfferId,
        quantity: line.quantity,
        price: line.unitCents / 100,
        description: line.productName,
      });
    } else {
      fallbackCents += lineCents;
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
    // Should never happen if totalCents > 0, but guard anyway
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
// Items MUST be included in the initial POST (the API crashes with 500 if
// the items array is omitted, returning no useful error message).
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
