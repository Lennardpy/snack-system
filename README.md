# SSS — Stress Snack System

A self-service snack kiosk for the Stress Study association. Members tap their
student card on a reader at the kiosk, pick snacks on a touchscreen, and confirm.
Purchases are batched into monthly invoices and exported to **Congressus** for
SEPA billing. Rebuilt from the original Mendix app as a Next.js application
running on Railway.

```
  Student card ──tap──▶ Kiosk shop ──confirm──▶ Invoice ──monthly──▶ Congressus (SEPA)
```

## Highlights

- **Tap-to-shop kiosk** — NFC student card opens a personal, time-limited shop session.
- **Self-service card linking** — unrecognised cards are linked to a member via a one-click email verification (no admin needed).
- **Admin panel** — dashboard with revenue/popularity over a selectable timeframe, member management, product & price management, and invoice editing/export.
- **Congressus integration** — members, products, and monthly invoices sync to Congressus.
- **Built for a shared physical kiosk** — idle auto-reset, rate limiting, and a strict "data only behind a valid session" security model.

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router, server + client components) |
| Language | TypeScript, React 19 |
| Styling | Tailwind CSS v4 |
| Database | PostgreSQL |
| ORM | Prisma 7 with `@prisma/adapter-pg` (no embedded query engine) |
| Email | Resend |
| Hosting | Railway (nixpacks builder) |
| Card reader | [Arago Card Reader](https://github.com/SVArago/Arago-Card-Reader) over WebSocket |
| External billing | Congressus API v30 |

## Documentation

| Doc | What's in it |
|-----|--------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System overview, components, and the main user/data flows |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Database schema, every model and field |
| [docs/API.md](docs/API.md) | Full HTTP API reference (public, auth, admin) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Railway setup, environment variables, migrations, the persistent volume |
| [docs/CARD_READER.md](docs/CARD_READER.md) | Setting up the Arago reader and the kiosk laptop |
| [docs/CONGRESSUS.md](docs/CONGRESSUS.md) | How members, products, and invoices map to Congressus (and its API quirks) |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | Day-to-day operations for board members |
| [docs/SECURITY.md](docs/SECURITY.md) | The security model and the decisions behind it |

## Quick start (local development)

```bash
# 1. Install dependencies (Node 20.9+ required)
npm install

# 2. Configure environment
cp .env.example .env.local
#   then edit .env.local — see docs/DEPLOYMENT.md for every variable

# 3. Set up the database
npx prisma migrate deploy      # apply migrations
npm run seed                   # create the admin user + product categories

# 4. Run
npm run dev                    # http://localhost:3000
```

- Kiosk: `http://localhost:3000`
- Admin: `http://localhost:3000/admin` (credentials from `ADMIN_EMAIL` / `ADMIN_PASSWORD`)

> Without a physical card reader the kiosk's status dot will show "Reader
> offline". You can still exercise the shop by creating a shop session manually —
> see [docs/CARD_READER.md](docs/CARD_READER.md#testing-without-a-reader).

## Project layout

```
src/
  app/
    page.tsx                     Kiosk idle/tap screen (WebSocket to card reader)
    shop/[token]/page.tsx        The shop (per shop-session token)
    admin/
      login/                     Admin login
      (protected)/               Auth-gated admin panel + sidebar shell
        page.tsx                 Dashboard
        members/ products/ invoices/
    api/
      card/                      scan · register · verify
      cart/  orders/             shopping + checkout
      products/                  public product list (kiosk)
      images/products/[file]     serves product images from the volume
      auth/                      login · logout
      admin/                     all admin endpoints (requireAdmin)
      health/                    healthcheck
  lib/
    prisma.ts      Prisma client (pg adapter)
    auth.ts        Session + requireAdmin
    congressus.ts  Congressus API client
    email.ts       Resend email
    rate-limit.ts  In-memory rate limiter
prisma/
  schema.prisma    Data model
  migrations/       SQL migrations
  seed.ts          Admin user + categories
```

## Common scripts

```bash
npm run dev     # local dev server
npm run build   # production build
npm run start   # run the production build
npm run lint    # eslint
npm run seed    # seed admin user + categories
```
</content>
