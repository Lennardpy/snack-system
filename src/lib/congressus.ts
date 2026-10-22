// Congressus API v30 client — one Congressus per association (Stress, Dimensie).
// Auth: Bearer token per association from an env var (never stored in the DB).

// Overridable only to point tests at a mock; production uses the real API.
const BASE = process.env.CONGRESSUS_API_URL ?? "https://api.congressus.nl/v30";

import type { AssociationId } from "./associations";

interface CongressusConfig {
  tokenEnv: string;
  // Only members with these status ids are synced (may drink / be invoiced).
  memberStatusIds: number[];
  invoiceWorkflowId: number;
  useDirectDebit: boolean;
  // SSS snacks folder — Stress only (Dimensie doesn't use the kiosk).
  sssFolderId: number | null;
  // Folder for PPP drinks; null until it's been created in that Congressus.
  pppFolderId: number | null;
  // Product used for lines without a mapped product offer (€0.01 × cents);
  // null = every line must have an offer.
  fallbackOfferId: number | null;
}

const intEnv = (name: string): number | null => {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : null;
};

const CONFIG: Record<AssociationId, CongressusConfig> = {
  stress: {
    tokenEnv: "CONGRESSUS_API_TOKEN",
    // 1845 = The Primary Membership, 1844 = The Secondary membership
    memberStatusIds: [1845, 1844],
    invoiceWorkflowId: 605,
    useDirectDebit: true,
    sssFolderId: 5952, // "SSS"
    // "PPP" (id 8804), created via the API parallel to SSS.
    pppFolderId: intEnv("CONGRESSUS_PPP_FOLDER_ID") ?? 8804,
    // "SSS purchases Mendix" — €0.01 per unit, quantity = total cents.
    fallbackOfferId: intEnv("CONGRESSUS_PRODUCT_OFFER_ID") ?? 118389,
  },
  dimensie: {
    tokenEnv: "CONGRESSUS_API_TOKEN_DIMENSIE",
    // 1588 = Lid, 1671 = Extraordinary member (not Erelid / Donateur)
    memberStatusIds: [1588, 1671],
    invoiceWorkflowId: intEnv("CONGRESSUS_DIMENSIE_WORKFLOW_ID") ?? 309,
    useDirectDebit: true,
    sssFolderId: null,
    pppFolderId: intEnv("CONGRESSUS_PPP_FOLDER_ID_DIMENSIE"),
    fallbackOfferId: intEnv("CONGRESSUS_PRODUCT_OFFER_ID_DIMENSIE"),
  },
};

export function congressusConfig(association: AssociationId): CongressusConfig {
  return CONFIG[association];
}

// Whether this association's Congressus can be reached (its token is set).
export function congressusConfigured(association: AssociationId): boolean {
  return !!process.env[CONFIG[association].tokenEnv];
}

function headers(association: AssociationId) {
  const token = process.env[CONFIG[association].tokenEnv];
  if (!token) throw new Error(`No Congressus API token configured for ${association} (${CONFIG[association].tokenEnv})`);
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// SSS lives in Stress's Congressus only.
const SSS_FOLDER_ID = CONFIG.stress.sssFolderId!;

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

// Fetch all members with an allowed status from this association's Congressus,
// walking pagination.
export async function fetchAllMembers(association: AssociationId): Promise<CongressusMember[]> {
  const members: CongressusMember[] = [];

  for (const statusId of CONFIG[association].memberStatusIds) {
    let page = 1;

    while (true) {
      const res = await fetch(
        `${BASE}/members?page=${page}&page_size=100&status_id=${statusId}`,
        { headers: headers(association) }
      );

      if (!res.ok) {
        throw new Error(`Congressus (${association}) /members failed: ${res.status} ${await res.text()}`);
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
    { headers: headers("stress") }
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
    headers: headers("stress"),
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
  // Products are updated with PUT /products/{id} — NOT PATCH (which returns 404),
  // and {id} is the product OFFER id (the object's `id`), not the product entity
  // id. (The old PATCH-on-product_id call silently failed, so edits never synced.)
  //
  // PUT replaces the resource, so we GET the current object and resend it with
  // name/price changed to avoid dropping fields like folder/published. VAT is
  // deliberately omitted — the API 500s on any vat_category write (see
  // CONGRESSUS.md), and SSS products carry no VAT anyway.
  const getRes = await fetch(`${BASE}/products/${congressusOfferId}`, { headers: headers("stress") });
  if (!getRes.ok) {
    throw new Error(
      `Congressus get product ${congressusOfferId} failed: ${getRes.status} ${await getRes.text()}`
    );
  }
  const current: {
    folder?: { id: number };
    published?: boolean;
    is_archived?: boolean;
  } = await getRes.json();

  const res = await fetch(`${BASE}/products/${congressusOfferId}`, {
    method: "PUT",
    headers: headers("stress"),
    body: JSON.stringify({
      folder_id: current.folder?.id ?? SSS_FOLDER_ID,
      name,
      price: priceEuros,
      published: current.published ?? true,
      is_archived: current.is_archived ?? false,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Congressus update product ${congressusOfferId} failed: ${res.status} ${await res.text()}`
    );
  }
}

// ── PPP products (drinks) ─────────────────────────────────────────────────────
//
// PPP drinks live in a SEPARATE Congressus folder from SSS snacks: for Stress
// "PPP" (id 8804), created via the API parallel to SSS (5952). Each association
// has its own folder (CongressusConfig.pppFolderId).

export type VatCategory = "ZERO" | "LOW" | "STANDARD";

// VAT is intentionally NOT pushed to Congressus. The Congressus product API
// CANNOT set VAT — confirmed by exhaustively probing the live API (folder 8804):
// every validly-typed `vat_category`/`vat_percentage` payload returns HTTP 500
// (server crash); `vat_category.id` is rejected ("Unknown field") and scalars give
// "Invalid input type". Sending VAT would 500 the create and prevent the product
// from being made at all, so we omit it. VAT is kept on our side only
// (PppProduct.vatCategory) and must be set per-product in the Congressus UI.
//   LOW → VL (9%), STANDARD → VH (21%), ZERO → none.
export async function createPppCongressusProduct(
  association: AssociationId,
  name: string,
  priceEuros: number,
  _vatCategory: VatCategory = "LOW",
  folderId: number | null = CONFIG[association].pppFolderId
): Promise<{ offerId: number | null }> {
  if (folderId == null) throw new Error(`No PPP product folder configured in ${association}'s Congressus`);
  const res = await fetch(`${BASE}/products`, {
    method: "POST",
    headers: headers(association),
    body: JSON.stringify({
      folder_id: folderId,
      name,
      price: priceEuros,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Congressus create PPP product failed: ${res.status} ${await res.text()}`
    );
  }

  // Resolve the real offer ID from the PPP folder listing (same quirk as SSS).
  const folderRes = await fetch(
    `${BASE}/products?folder_id=${folderId}&page_size=100`,
    { headers: headers(association) }
  );
  if (!folderRes.ok) {
    throw new Error(
      `Congressus PPP folder fetch failed: ${folderRes.status} ${await folderRes.text()}`
    );
  }
  const data: { data: CongressusFolderProduct[] } = await folderRes.json();
  const matches = data.data.filter((p) => p.name === name && !p.is_archived);
  if (matches.length === 0) {
    throw new Error(`Created PPP product "${name}" but could not find it in the PPP folder`);
  }
  const best = matches.reduce((a, b) =>
    a.product_offer_id > b.product_offer_id ? a : b
  );
  return { offerId: best.product_offer_id };
}

// Create a product folder at the top level of an association's Congressus (e.g.
// "PPP" in Dimensie's, on its first export). Returns the folder id. Body shape as
// confirmed when the Stress PPP folder was created (docs/CONGRESSUS.md).
export async function createProductFolder(association: AssociationId, name: string): Promise<number> {
  const res = await fetch(`${BASE}/product-folders`, {
    method: "POST",
    headers: headers(association),
    body: JSON.stringify({ name, parent_id: null, published: false, slug: name.toLowerCase() }),
  });
  if (!res.ok) {
    throw new CongressusHttpError(`Congressus (${association}) create folder failed: ${res.status} ${await res.text()}`, res.status);
  }
  const folder: { id: number } = await res.json();
  return folder.id;
}

// ── Sale Invoices (export) ────────────────────────────────────────────────────


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
  association: AssociationId,
  lines: InvoiceLineItem[],
  reference: string
): { product_offer_id: number; quantity: number; price: number; description: string }[] {
  const items: { product_offer_id: number; quantity: number; price: number; description: string }[] = [];
  const fallbackOfferId = CONFIG[association].fallbackOfferId;
  // Throws before anything is sent, so the export releases the orders (nothing created).
  const needFallback = () => {
    if (fallbackOfferId == null) {
      throw new CongressusHttpError(`A line has no ${association} Congressus product and there is no fallback product`, 400);
    }
    return fallbackOfferId;
  };

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
      product_offer_id: needFallback(),
      quantity: fallbackCents,
      price: 0.01,
      description: reference,
    });
  }

  // items array must never be empty (Congressus crashes with 500)
  if (items.length === 0) {
    const totalCents = lines.reduce((s, l) => s + l.quantity * l.unitCents, 0);
    items.push({
      product_offer_id: needFallback(),
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
// An HTTP error response from Congressus. A 4xx means the request was rejected and
// nothing was created; a 5xx (or a timeout / network error, which throw other
// errors) leaves it unknown whether the invoice exists.
export class CongressusHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
  get definitelyNotCreated(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export async function createSaleInvoice(
  association: AssociationId,
  memberId: number,
  lines: InvoiceLineItem[],
  reference: string
): Promise<number> {
  const items = buildCongressusItems(association, lines, reference);
  const cfg = CONFIG[association];

  const res = await fetch(`${BASE}/sale-invoices`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: headers(association),
    body: JSON.stringify({
      member_id: memberId,
      invoice_date: new Date().toISOString().split("T")[0],
      invoice_workflow_id: cfg.invoiceWorkflowId,
      use_direct_debit: cfg.useDirectDebit,
      invoice_reference: reference,
      items,
    }),
  });

  if (!res.ok) {
    throw new CongressusHttpError(
      `Congressus (${association}) create invoice failed for member ${memberId}: ${res.status} ${await res.text()}`,
      res.status
    );
  }

  const invoice: { id: number } = await res.json();
  return invoice.id;
}
