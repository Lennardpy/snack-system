# Congressus Integration

SSS syncs three things with **Congressus API v30**: members (in), products (out),
and monthly sale-invoices (out). Client code lives in `src/lib/congressus.ts`.

- **Base URL:** `https://api.congressus.nl/v30`
- **Auth:** `Authorization: Bearer ${CONGRESSUS_API_TOKEN}` (a generic API token)
- **SSS product folder id:** `5952` · **PPP (drinks) folder id:** `8804`
- **Imported member statuses:** `1845` (Primary), `1844` (Secondary), `4119` (Honorary)
- **Invoice workflow id:** `605` (Contribution)

> The bar subsystem (PPP) reuses this same client. See [PPP.md](PPP.md). PPP
> products live in folder **`8804`** (`webshop/ppp`). The export puts a member's
> pending snacks AND drinks on **one** Congressus invoice per export (`"SSS & PPP <period>"`)
> — see below.

## Members (Congressus → SSS)

`Members → Sync from Congressus` calls `fetchAllMembers()`, which pages through
`GET /members?status_id=…` for the Primary, Secondary and Honorary statuses and upserts
each by `congressusId`. A member is marked `active` unless Congressus says they
are deleted, locked, archived, or deceased. Members without an email are skipped
(email is the unique key used for card linking).

## Products (SSS → Congressus)

When you create a product in the admin panel it is also created in the Congressus
SSS folder, and its **offer id** is stored on the local product
(`congressusProductOfferId`). Name/price edits sync too.

### ⚠️ The product id vs offer id quirk
A Congressus product has both a product entity id and a **product offer id**.
**Invoice line items reference the offer id**, not the product id.

- `POST /products` returns `id` / `product_offer_id` in the **product-entity**
  range (e.g. `110xxx`), which is **not** the id used on invoices.
- The real offer id (e.g. `118xxx`) only appears once you read the product back
  from the **folder listing** (`GET /products?folder_id=5952`).

So `createCongressusProduct()` creates the product and then re-queries the folder
to find the real offer id. Using the wrong id silently produces an invoice with
**empty line items**.

> Also note: `GET /products/{id}` returns 404 for any id, and `page_size` maxes
> out at **100**.

### Backfilling existing products
Products created before offer ids were tracked can be matched to the folder by
name/price via `POST /api/admin/sync-product-offers`.

## Sale invoices (SSS → Congressus)

`Invoices → Export SSS + PPP to Congressus` (same action on both invoices pages):
1. Claim and group all `CONFIRMED` SSS **and** PPP orders by **member × calendar
   month** (see SECURITY.md for the duplicate-proof claim).
2. For each group, create one Congressus sale-invoice via `POST /sale-invoices`:
   - `invoice_workflow_id: 605`, `use_direct_debit: true`
   - `invoice_reference: "SSS & PPP <period>"` (Dutch locale: "SSS & PPP juni 2026",
     or "SSS & PPP mei – juni 2026" when the orders span months) — snack and drink
     lines on the same invoice
   - **`items[]` built from the grouped lines** — one line per product using its
     offer id; any product without an offer id is rolled into a single fallback
     line using the **"SSS purchases Mendix"** product
     (`CONGRESSUS_PRODUCT_OFFER_ID`, default `118389`) at `€0.01 × total cents`.
3. Mark each local invoice `EXPORTED` with the returned `congressusInvoiceId`.

### ⚠️ The 500-instead-of-400 quirk
`items` is **required** in the `POST /sale-invoices` body, but the API responds
with a generic **500 Internal Server Error** (not a 400 validation error) when it
is missing — and items cannot be added afterwards via a separate endpoint. The
client therefore always includes the `items` array in the initial create call.

## The "SSS purchases Mendix" fallback

This mirrors the original Mendix system's billing method: a single €0.01 product
charged `total_cents` times. It is used whenever a product has no Congressus offer
id, so an export can never fail just because one product wasn't synced. Once all
products have offer ids, invoices show real product line items instead.

## PPP (drinks) — folder, VAT, two-invoice export

The bar subsystem syncs the same way, into its own folder.

- **PPP folder `8804`** (`webshop/ppp`) — created via `POST /v30/product-folders`,
  parallel to SSS. Hardcoded default in `createPppCongressusProduct()`, overridable
  with `CONGRESSUS_PPP_FOLDER_ID`. New drinks sync here and store their offer id.
- **VAT is NOT sent** — the product API **cannot** set VAT. Every write shape was
  probed against the live API: `vat_category: {name|percentage}` and
  `vat_percentage` all return **HTTP 500**; `vat_category: {id}` is rejected
  ("Unknown field"); scalars give "Invalid input type". So PPP products are created
  without VAT (like all SSS products, which are unset). VAT is kept locally on
  `PppProduct.vatCategory`; set it in the Congressus UI if required. (Read shape:
  `vat_category: { id, name, percentage }`; org categories are VL = 9 %, VH = 21 %,
  no 0 %.)
- **Product update endpoint** is `PUT /v30/products/{id}` (and `DELETE`); `PATCH`
  returns 404. `{id}` is the **offer id** (object `id`), not the product entity id.
- **One combined invoice** — `POST /api/admin/invoices/export` (from either
  invoices page, "Export SSS + PPP to Congressus") groups ALL `CONFIRMED` SSS and
  PPP orders by member (any month) and creates **one** Congressus sale-invoice per
  member, reference `"SSS & PPP <period>"` (e.g. "september – oktober 2026"), holding both the snack lines and the drink lines —
  so a member gets one invoice and one direct debit. PPP line descriptions include
  the activity name (`"Pils – Borrel 28 jun"`); the same product at different
  activities/prices stays on separate lines. Every line keeps its own offer id;
  lines without one use the Mendix fallback. Source rows (both tables) are marked
  `EXPORTED` with the same Congressus invoice id.

## Quick reference of quirks

| Symptom | Cause | Handling |
|---------|-------|----------|
| Invoice created but **no line items** | used the product id instead of the offer id | offer id is read from the folder listing |
| `POST /sale-invoices` → **500** | `items` array omitted | always send `items` in the create call |
| `GET /products/{id}` → **404** | endpoint not usable with these ids | read products from the folder listing |
| `422 page_size` | `page_size > 100` | cap at 100 |
| Product VAT won't set (**500**) | API can't write `vat_category` / `vat_percentage` | omit VAT; set it in the Congressus UI |
| Product `PATCH` → **404** | products use `PUT`/`DELETE`, not `PATCH` | use `PUT /products/{offerId}` |
