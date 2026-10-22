# Data Model

Defined in `prisma/schema.prisma`. PostgreSQL via Prisma 7 (`@prisma/adapter-pg`).
All money is stored as **integer cents**.

> This document covers the SSS snack kiosk. The **PPP bar subsystem** adds
> `Ppp*` models, `MemberRole`, `PasswordSetupToken`, and reuses `Member`/`Card`/
> `User.memberId` — see [PPP.md](PPP.md#data-model-ppp).

## Entity overview

```
Member ─┬─< Card
        ├─< SaleInvoice ─< InvoiceLine >─ Product >─ ProductCategory
        ├─< ShopSession
        └─ User (optional 1:1)            User ─< Session

CardRegistration   (pending card links; standalone)
```

## Models

### Member
A person synced from Congressus. Only Primary and Secondary members are imported.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `congressusId` | Int? | **unique** — the Congressus member id; null once deleted (anonymised) |
| `firstName`, `lastName` | String | |
| `email` | String | **unique** — must match their Congressus login email |
| `active` | Boolean | false if deleted/locked/archived/deceased in Congressus |
| `deletedAt` | DateTime? | set when an admin deletes a member with exported history (row kept, anonymised, hidden from lists) |
| `createdAt`, `updatedAt` | DateTime | |
| Relations | `cards[]`, `invoices[]`, `user?` | |

### Card
A physical student card linked to a member.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `uid` | String | **unique** — the card's NFC UID (normalised to upper-case) |
| `name` | String? | optional label (e.g. "Student card") |
| `createdAt` | DateTime | |
| `memberId` → `member` | relation | |

### ShopSession
A short-lived session created when a card is tapped (or via admin "Enter store").
The token is the value in the `/shop/<token>` URL.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `token` | String (cuid) | **unique** — bearer token in the shop URL |
| `memberId` | String | the member this session shops as |
| `expiresAt` | DateTime | 10 min from creation; extended on cart activity |
| `createdAt` | DateTime | |

### ProductCategory
| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `name` | String | **unique** |
| `sortOrder` | Int | display order |
| `products[]` | relation | |

### Product
A snack/drink for sale. Mirrored into the Congressus "SSS" product folder.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `name` | String | |
| `price` | Int | **cents** |
| `stock` | Int? | null = unlimited |
| `published` | Boolean | only published products appear in the kiosk |
| `archived` | Boolean | hidden from admin lists |
| `imageUrl` | String? | `/api/images/products/<file>` |
| `sortOrder` | Int | |
| `congressusProductId` | Int? | **unique** — the Congressus product_offer_id (also stored below) |
| `congressusProductOfferId` | Int? | **unique** — the offer id used in invoice line items |
| `categoryId` → `category` | relation | |
| `invoiceLines[]` | relation | |

> The Congressus offer id is what an invoice line references. Both fields hold
> the same value in practice; see [CONGRESSUS.md](CONGRESSUS.md) for why two
> fields exist.

### SaleInvoice
A member's basket → confirmed purchase → exported record. Status drives its
lifecycle.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `status` | `InvoiceStatus` | `CONCEPT` → `CONFIRMED` → `EXPORTED` |
| `totalCents` | Int | recomputed from its lines |
| `confirmedAt` | DateTime? | set on checkout |
| `exportedAt` | DateTime? | set on Congressus export |
| `congressusInvoiceId` | Int? | the Congressus sale-invoice id after export |
| `createdAt` | DateTime | |
| `memberId` → `member` | relation | |
| `lines[]` | relation | |

**Lifecycle**
- `CONCEPT` — the live cart while shopping. One open concept per member.
- `CONFIRMED` — the member confirmed the order; awaiting monthly export.
- `EXPORTED` — pushed to Congressus. Read-only in the admin panel.

### InvoiceLine
| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `quantity` | Int | |
| `unitCents` | Int | price **locked at purchase time** |
| `invoiceId` → `invoice` | relation | |
| `productId` → `product` | relation | |

### User
An admin (or, in principle, a member-linked) login.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `email` | String | **unique** — admin login uses an email |
| `passwordHash` | String | bcrypt |
| `role` | `UserRole` | `ADMIN` or `MEMBER` |
| `createdAt` | DateTime | |
| `memberId` → `member` | optional 1:1 | |
| `sessions[]` | relation | |

### Session
Admin login session, carried as an httpOnly cookie.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `token` | String (cuid) | **unique** — value of the `session` cookie |
| `expiresAt` | DateTime | 7 days |
| `createdAt` | DateTime | |
| `userId` → `user` | relation | `onDelete: Cascade` |

### CardRegistration
A pending card-link request, created when an unrecognised card is tapped and an
email is entered.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `uid` | String | the card UID to be linked |
| `token` | String (cuid) | **unique** — value in the verification email link |
| `email` | String | the member email entered at the kiosk |
| `expiresAt` | DateTime | 15 min |
| `usedAt` | DateTime? | set once the card is linked (single-use) |
| `createdAt` | DateTime | |

## Enums

```prisma
enum InvoiceStatus { CONCEPT  CONFIRMED  EXPORTED }
enum UserRole      { ADMIN    MEMBER }
```

## Notes on deletion

- Deleting a **member** is blocked while they have unbilled (`CONFIRMED`/`EXPORTING`) SSS or PPP orders. Without history they're removed with their cards, shop sessions and carts; with exported history they're anonymised (`deletedAt`, `congressusId` null) so their orders keep counting in reports.
- Deleting/editing an **invoice** is blocked once it is `EXPORTED`.
- There is no DB-level cascade from `SaleInvoice` to `InvoiceLine` (except `Session`→`User`), so the API deletes lines explicitly inside transactions.

## Migrations

SQL migrations live in `prisma/migrations/`. Apply them with:

```bash
npx prisma migrate deploy
```

On Railway this runs automatically at container start (see [DEPLOYMENT.md](DEPLOYMENT.md)).
