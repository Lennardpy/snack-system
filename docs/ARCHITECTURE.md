# Architecture

## Overview

SSS is a single Next.js application (App Router) that serves several audiences from
one deployment:

1. **The kiosk** — a touchscreen in the association room, driving the tap-to-shop flow.
2. **Members' phones** — only for the one-time card-linking email verification.
3. **The board (admins)** — the management panel.
4. **Bartenders** — the **PPP** bar POS for selling drinks at activities
   (`/ppp/*`), reusing the same members, cards, auth, and Congressus client. See
   [PPP.md](PPP.md).

It talks to three external systems: a **PostgreSQL** database, the **Congressus**
membership/billing API, and **Resend** for transactional email. On the kiosk
laptop, a local **Arago Card Reader** process broadcasts card taps over a
WebSocket that the kiosk page listens to.

```
                    ┌─────────────────────────── Railway ───────────────────────────┐
                    │                                                                 │
  Kiosk laptop      │   Next.js app (server + client)          PostgreSQL            │
  ┌────────────┐    │   ┌───────────────────────┐    ┌──────────────────────────┐    │
  │ Browser    │◀───┼──▶│ Pages  /  API routes  │◀──▶│ Prisma (pg adapter)       │    │
  │ (kiosk UI) │    │   └───────────┬───────────┘    └──────────────────────────┘    │
  └─────┬──────┘    │               │                                                │
        │ ws://      │               ├──────────▶ Congressus API v30 (members, …)    │
  ┌─────▼──────┐    │               └──────────▶ Resend (verification emails)        │
  │ Arago      │    │                                                                │
  │ Card Reader│    └─────────────────────────────────────────────────────────────┘
  └────────────┘
```

## Components

### Kiosk page (`src/app/page.tsx`)
A client component that:
- Opens a WebSocket to the local card reader (`NEXT_PUBLIC_CARD_READER_WS_URL`, default `ws://localhost:3000`) and auto-reconnects every 3 s, showing a connection dot.
- On a card tap, receives `{ uid, atqa, sak }` and calls `POST /api/card/scan`.
- If the card is registered → navigates to `/shop/<token>`.
- If not → shows an email form to start card linking (`POST /api/card/register`).
- Renders all kiosk states: idle, scanning, unregistered (email form), email sent, **email not found**, error.

### Shop page (`src/app/shop/[token]/page.tsx`)
Client component scoped to a single **shop-session token** (in the URL):
- Loads the product catalogue (`GET /api/products`) and the member's cart (`GET /api/cart?token=`).
- Whole product cards are tap-to-add; a `− [qty] +` stepper adjusts quantities.
- Greets the member by name (from the token-scoped cart endpoint) and plays a welcome animation.
- **Idle auto-reset**: after 60 s of inactivity, a 15 s "Still there?" countdown appears; if untouched, the session is deleted server-side and the kiosk returns to the tap screen.
- Confirm → `POST /api/orders/confirm`, which finalises the invoice.

### Card verification (`src/app/api/card/verify/route.ts`)
Standalone HTML pages (not React) served directly from the API, because they are
opened from an email on the member's phone:
- **GET** validates the token and renders a confirmation page (a form).
- **POST** (the form submit) actually links the card and shows a success page.

This GET-shows / POST-acts split exists because email clients **pre-fetch** links
to scan for malware — a GET that performed the action would link the card before
the member ever clicked. See [SECURITY.md](SECURITY.md).

### Admin panel (`src/app/admin/(protected)/`)
Auth-gated by a server-side layout (`requireAdmin()` → redirect). A shared
sidebar shell (`AdminNav`) wraps four pages:
- **Dashboard** — KPIs, a daily revenue bar chart, and a most-popular-items ranking over a selectable timeframe.
- **Members** — search, "Enter store" (open the kiosk as that member), delete.
- **Products** — add products, inline price editing, image upload, publish/archive.
- **Invoices** — review, edit line quantities, delete, bulk-clear, and export to Congressus.

### Library code (`src/lib/`)
- `prisma.ts` — a singleton Prisma client using `@prisma/adapter-pg` (Prisma 7 has no embedded query engine).
- `auth.ts` — `getSession()` reads & validates the `session` cookie; `requireAdmin()` additionally checks the `ADMIN` role.
- `congressus.ts` — the Congressus API v30 client (members, products, invoices).
- `email.ts` — Resend wrapper for the verification email.
- `rate-limit.ts` — in-memory sliding-window limiter (per Railway instance).

## Key flows

### 1. Tap to shop (registered card)
```
Reader → ws → kiosk page → POST /api/card/scan { uid }
  → look up Card by uid → member active?
  → delete member's old ShopSessions, create a new one (10 min TTL)
  → returns { token }
  → kiosk navigates to /shop/<token>
  → shop loads cart + products, member shops, Confirm
  → POST /api/orders/confirm → invoice CONCEPT → CONFIRMED, session deleted
```

### 2. Linking an unrecognised card
```
Reader → kiosk page → POST /api/card/scan → 404 "Card not registered"
  → kiosk shows email form → POST /api/card/register { uid, email }
      • email matches an active member → create CardRegistration (15 min TTL),
        Resend sends a verification link, kiosk shows "Check your email"
      • email not found → kiosk shows "Email not found" screen
      • member inactive → "contact the board" message
  → member opens email on phone → GET /api/card/verify?token= (confirmation page)
  → taps "Yes, link my card" → POST /api/card/verify → Card created
  → success page. (No shop session is created here — the shop is only reachable
    by physically tapping the card at the kiosk.)
```

### 3. Monthly invoice export
```
Each Confirm creates/updates a CONFIRMED SaleInvoice with its lines.
Admin → Invoices → Export SSS + PPP to Congressus:
  claim all CONFIRMED SSS + PPP orders (→ EXPORTING), group by member × month
  → one Congressus sale-invoice per group, snacks + drinks together
    ("SSS & PPP <month>", workflow 605, direct debit)
  → line items use each product's Congressus offer ID; products without one
    fall back to the "SSS purchases Mendix" product at €0.01 × total cents
  → mark the local invoices EXPORTED with the Congressus invoice id
```

See [CONGRESSUS.md](CONGRESSUS.md) for the integration's important quirks.

## Sessions: two distinct kinds

| | Shop session | Admin session |
|--|--------------|---------------|
| Model | `ShopSession` | `Session` |
| Created by | Card tap / "Enter store" | Admin login |
| Carried as | `token` in the `/shop/<token>` URL | httpOnly `session` cookie |
| Lifetime | 10 min, extended on cart activity | 7 days |
| Grants | The kiosk shop **as one member** | The admin panel |

## Request authorisation at a glance

- **Admin routes** (`/api/admin/*`) — every handler calls `requireAdmin()`; middleware additionally requires the cookie to be present.
- **Shop routes** (`/api/cart`, `/api/orders/confirm`) — require a valid `ShopSession` token.
- **Card-verify** — requires a valid `CardRegistration` token.
- **Public** (`/api/products`, `/api/card/scan`, `/api/card/register`, `/api/health`, product images) — no auth; the data routes among these are rate-limited and never return member data.

Full details in [SECURITY.md](SECURITY.md).
