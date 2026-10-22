# API Reference

All routes live under `src/app/api/`. Money is in integer **cents**. JSON unless
noted. Errors are `{ "error": "message" }` with an appropriate status.

> Covers the SSS snack kiosk + admin. The **PPP bar** routes (`/api/ppp/*`,
> `/api/admin/ppp/*`, `/api/auth/card-login`, `/api/auth/set-password`) are listed
> in [PPP.md](PPP.md#api-reference-ppp).

Authorisation classes:
- **Public** — no auth.
- **Shop token** — requires a valid `ShopSession` token (passed in the body or `?token=`).
- **Registration token** — requires a valid `CardRegistration` token.
- **Admin** — requires a valid admin session cookie for the right site (`requireSss()` on the SSS, `requirePpp()` on the PPP, `requireMemberAdmin()` for the shared member routes, `requireOverallAdmin()` for `/api/admin/accounts`); returns `401` otherwise. PPP data is scoped to the login's association — another association's record answers `404`.

---

## Public

### `GET /api/health`
Healthcheck used by Railway. Returns `200`.

### `GET /api/products`
Published, non-archived products for the kiosk. **Trimmed** payload — no internal
fields are exposed.
```json
{ "products": [
  { "id": "…", "name": "Mars", "price": 100, "imageUrl": null,
    "stock": null, "category": { "name": "Snacks" } }
] }
```

### `POST /api/card/scan`  · rate-limited 30/min/IP
Body `{ "uid": "AABBCCDD" }`. Looks up the card.
- `200 { "token": "…" }` — registered & active member; creates a fresh shop session. **No member data is returned.**
- `404 { "error": "Card not registered" }`
- `403 { "error": "Member inactive" }`

### `POST /api/card/register`  · rate-limited 10/min/IP
Body `{ "uid": "...", "email": "..." }`. Starts card linking.
- `200 { "ok": true }` — email matched an active member; a verification email was sent.
- `404 { "code": "EMAIL_NOT_FOUND", "error": "Email not found" }`
- `403 { "code": "INACTIVE", "error": "This membership is inactive…" }`
- `409 { "error": "Card already registered" }`

### `GET /api/card/verify?token=…`
Returns an **HTML** confirmation page (not JSON). Validates the registration
token; renders a form that POSTs back. Does not link the card (so email link
pre-fetch can't). Invalid/expired/used tokens render an error page.

### `POST /api/card/verify`
Form post with `token`. Links the card to the member, marks the registration
used, and returns an HTML success page. Does **not** open a shop session.

### `GET /api/cart?token=…`  · shop token
The member's current cart.
```json
{ "invoice": { "id": "…", "totalCents": 300, "lines": [ … ] } | null,
  "memberFirstName": "Lennard" }
```
`memberFirstName` is only returned here, behind a valid token.

### `POST /api/cart`  · shop token
Body `{ "token": "...", "productId": "...", "delta": 1 | -1 }`. Adds/removes one
unit, upserts the concept invoice, recomputes the total, and extends the session.

### `DELETE /api/cart?token=…`  · shop token
Ends the shop session (used by the idle auto-reset). Always `200`.

### `POST /api/orders/confirm`  · shop token
Body `{ "token": "..." }`. Marks the concept invoice `CONFIRMED`, sets
`confirmedAt`, and deletes the shop session. `400` if the cart is empty.

### `GET /api/images/products/<filename>`
Serves a product image from the upload volume. Path-traversal guarded;
long-cache headers.

---

## Auth

### `POST /api/auth/login`  · rate-limited 10/min/IP
Body `{ "email": "...", "password": "..." }`. On success sets an httpOnly
`session` cookie (7 days) and returns `{ "ok": true, "role": "ADMIN" }`.
`401` on bad credentials.

### `POST /api/auth/logout`
Clears the session cookie and deletes the DB session.

---

## Admin — all require an admin session

### `GET /api/admin/stats?range=7d|30d|90d|365d|all|since_export`
Aggregated sales over the timeframe (based on `CONFIRMED`/`EXPORTED` invoices).
`activeUsers` is the count of distinct members who purchased in the period.
`since_export` reports the still-**unbilled** sales (status `CONFIRMED` only) — the
money still to come since the last Congressus export; `lastExportAt` is that export's
timestamp (or `null` if nothing has been exported yet). The PPP dashboard's
`GET /api/admin/ppp/stats` takes the same `since_export` range (see [PPP.md](PPP.md)).
```json
{ "range": "30d", "lastExportAt": null, "revenueCents": 1910, "orderCount": 5, "itemsSold": 18,
  "avgOrderCents": 382, "activeUsers": 4,
  "topProducts": [ { "id": "…", "name": "Mars", "quantity": 9, "revenueCents": 900 } ],
  "topSpenders": [ { "id": "…", "name": "Jane Doe", "spentCents": 1270, "orderCount": 3 } ],
  "recentPurchases": [ { "id": "…", "memberName": "Jane Doe", "at": "2026-06-04T14:23:39Z",
    "totalCents": 175, "items": [ { "name": "Cola", "quantity": 1 } ] } ],
  "series": [ { "date": "2026-06-01", "revenueCents": 455 } ] }
```

### `GET /api/admin/members`
All members with their cards, sorted by name.

### `GET /api/admin/members/[id]`
Member dashboard data: member (roles, cards with UIDs), `sss`/`ppp` totals
(`spentCents`, `openCents` = confirmed but not yet exported, `orders`) and
`purchases` — every confirmed/exported SSS + PPP invoice with lines, newest first.
Page: `/admin/members/[id]` (linked from the Members list).

### `DELETE /api/admin/members/[id]/cards/[cardId]`
Unlinks one card (e.g. a **lost card**): deletes only that `Card` row. The member,
invoices and history stay; the UID becomes unregistered and can be linked again.

### `DELETE /api/admin/members/[id]`
Deletes a member. `409` while they have unbilled orders (SSS or PPP, `CONFIRMED`/
`EXPORTING`). With no purchase history the member is removed completely (cards,
shop sessions, abandoned carts). With exported history they are **anonymised**
instead: name → "Deleted member", email erased, cards/sessions/roles/carts and any
bartender-account link removed, `congressusId` → null, `deletedAt` set — so past
orders and revenue figures stay correct. Returns `{ ok, anonymised }`.

### `POST /api/admin/members/[id]/shop`
Opens the kiosk shop **as this member**: replaces their sessions, creates a
10-min shop session, returns `{ "token": "…" }`. The admin then navigates to
`/shop/<token>`.

### `POST /api/admin/members/sync`
Pulls all Primary + Secondary members from Congressus and upserts them, then
prunes members missing from that list: **deleted** if they have no invoices (and no
bartender login), otherwise **deactivated** (purchases blocked; history kept).
Returns `{ created, updated, skipped, total, deleted, deactivated, openInvoices:
[{ name, openCents }], pruneSkipped }` — `openInvoices` = deactivated members with
unexported (CONFIRMED) orders; `pruneSkipped` is a message when the safety guard
(empty list or < half the active members) skipped the clean-up. `502` if the
Congressus fetch fails (nothing changed).

### `GET /api/admin/products`
All products (incl. archived) with categories.

### `POST /api/admin/products`
Body `{ name, price (cents), categoryId, stock? }`. Creates the product **and**
a matching Congressus product, storing its offer id. If Congressus sync fails the
product is still created locally and a `warning` is returned.

### `PATCH /api/admin/products/[id]`
Partial update (`{ price }`, `{ published }`, `{ archived }`, `{ name }`, …).
Name/price changes are synced to Congressus.

### `POST /api/admin/products/[id]/image`
`multipart/form-data` with `image`. Stores the file on the upload volume and sets
`imageUrl`. Accepts JPG/PNG/WebP/GIF.

### `POST /api/admin/sync-product-offers`
One-off backfill: matches local products to the Congressus SSS folder by
name/price and stores the offer id. `GET` on the same path returns the raw
folder + local products for debugging.

### `GET /api/admin/invoices?status=CONFIRMED|EXPORTED`
Invoices of that status with member and lines.

### `DELETE /api/admin/invoices?status=CONFIRMED|EXPORTED`
**Bulk-delete** every invoice of that status (and its lines). Used to clear test
data. Returns `{ deleted: n }`.

### `PATCH /api/admin/invoices/[id]`
Body `{ "lines": [ { "id": "...", "quantity": 2 } ] }`. Updates line quantities
(`quantity ≤ 0` removes the line) and recomputes the total. `409` if the invoice
is already `EXPORTED`.

### `DELETE /api/admin/invoices/[id]`
Deletes the invoice and its lines. `409` if already `EXPORTED`.

### `POST /api/admin/invoices/export`
Atomically claims all `CONFIRMED` SSS **and** PPP orders (`CONFIRMED → EXPORTING`,
tagged with this run's id — a concurrent run gets none), groups them by member
(whatever month) and creates **one** Congressus sale-invoice per member with both
the snack and drink lines (`"SSS & PPP <period>"`, e.g. "oktober 2026" or
"september – oktober 2026"), then marks them `EXPORTED`. A member whose orders are
all €0 (free drinks) gets no Congressus invoice — their orders are marked
`EXPORTED` without an invoice id and counted in `nothingToPay`. A
Congressus 4xx returns that group to `CONFIRMED`; an unknown outcome
(timeout/5xx/network/DB failure after success) leaves it `EXPORTING` and counts it
in `needsCheck`. No body.
```json
{ "ok": true, "exported": 18, "sssOrders": 6, "pppOrders": 12, "congressusInvoices": 5, "failed": 0, "needsCheck": 0, "errors": [] }
```

### `POST /api/admin/invoices/reconcile`
Resolve orders stuck in `EXPORTING` after checking Congressus.
Body `{ sssIds: [...], pppIds: [...], action: "exported"|"pending", congressusInvoiceId? }` —
a combined invoice's SSS and PPP orders are resolved together.
Only claims older than 10 minutes; `409` otherwise. The invoice lists accept
`?status=EXPORTING` to list them.
