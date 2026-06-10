# Deployment

The app runs on **Railway** with a managed **PostgreSQL** plugin and a
**persistent volume** for product images.

## Build & start

`railway.toml`:
```toml
[build]
builder = "nixpacks"
buildCommand = "npx prisma generate && npm run build"

[deploy]
startCommand = "npx prisma migrate deploy && npm start"
healthcheckPath = "/api/health"
restartPolicyType = "on_failure"
```

Notes:
- **Migrations run at container start**, not during build. Build containers
  cannot reach the internal database host (`postgres.railway.internal`), so
  `prisma migrate deploy` is in the `startCommand`.
- **Node 20.9+** is required (Prisma 7). Enforced by `.nvmrc` (`20`) and
  `engines.node` in `package.json`.

## Environment variables

Set these on the Railway **service** (not the database plugin).

| Variable | Required | Example / default | Purpose |
|----------|----------|-------------------|---------|
| `DATABASE_URL` | ✅ | `${{Postgres.DATABASE_URL}}` | Postgres connection (use the internal URL). |
| `CONGRESSUS_API_TOKEN` | ✅ | `Pxw3…` | Bearer token for Congressus API v30. |
| `CONGRESSUS_PRODUCT_OFFER_ID` | – | `118389` | Fallback "SSS purchases Mendix" product offer id used when a product has no offer id. |
| `RESEND_API_KEY` | ✅ | `re_…` | Resend API key for verification emails. |
| `EMAIL_FROM` | ✅ | `SSS <noreply@51vo.nl>` | From address (must be a verified Resend domain). |
| `BASE_URL` | ✅ | `https://51vo.nl` | **Server-side** public URL. Used in email links and the verify form action. |
| `NEXT_PUBLIC_BASE_URL` | ✅ | same as `BASE_URL` (`https://51vo.nl`) | Client-visible URL. |
| `NEXT_PUBLIC_CARD_READER_WS_URL` | – | `ws://localhost:3000` | WebSocket the kiosk connects to for card taps. Baked into the client bundle at build time. |
| `UPLOAD_DIR` | – | `/data/uploads/products` | Where product images are written (the volume mount). |
| `ADMIN_EMAIL` | seed | `secretary@stress.utwente.nl` | Admin login created by `npm run seed`. |
| `ADMIN_PASSWORD` | seed | – | Admin password for the seeded user. |

### `BASE_URL` vs `NEXT_PUBLIC_BASE_URL` — important
`NEXT_PUBLIC_*` variables are **baked into the client bundle at build time** and
are evaluated in the browser. Server-side code (email links, the verify form
action) must use the plain **`BASE_URL`** so links always point at production
regardless of where the page was opened. Setting only `NEXT_PUBLIC_BASE_URL`
caused verification emails to link to `localhost` — keep both set and equal.

### Custom domain (`51vo.nl`)
The app is served from Railway under the custom domain **`https://51vo.nl`**:
1. Railway → the service → **Settings → Networking → Custom Domain** → add
   `51vo.nl` (or a subdomain), and create the CNAME record Railway shows at your
   DNS provider.
2. Set **`BASE_URL`** and **`NEXT_PUBLIC_BASE_URL`** to `https://51vo.nl` and
   redeploy. This is what makes the card-verification **emails** and the verify
   form point at the new domain — adding the domain in Networking alone is **not**
   enough, because `NEXT_PUBLIC_BASE_URL` is baked into the client at build time.
3. Keep `EMAIL_FROM` on a Resend-verified domain (already `…@51vo.nl`).

## Persistent volume (product images)

Railway containers have an **ephemeral filesystem** — anything written to disk is
lost on every redeploy. Product images are therefore stored on a **Railway
Volume**:

1. Railway → the service → **Settings → Volumes → Add Volume**.
2. Mount path: **`/data`**.

Images are written to `/data/uploads/products/<productId>.<ext>` and served via
`GET /api/images/products/<filename>` (not from `public/`, which is read-only at
runtime and rebuilt each deploy). The path is overridable with `UPLOAD_DIR`;
locally it defaults to `./public/uploads/products`.

> Static assets that ship with the code (e.g. `public/stress-logo.svg`) are baked
> into the build and need **no** volume — only user-uploaded images do.

## First-time setup

```bash
# After the first deploy, seed the admin user + product categories.
# Locally (pointing at the production DB public URL) or via railway run:
npm run seed        # uses ADMIN_EMAIL / ADMIN_PASSWORD
```

Then sync data from Congressus from the admin panel:
1. Log in at `/admin`.
2. **Members → Sync from Congressus**.
3. **Products** — add your snacks (each one also creates a Congressus product).

## Deploying changes

```bash
railway up          # build + deploy the current working tree
railway logs        # tail logs
railway status      # service + database status
```

A healthcheck on `/api/health` must pass for the deploy to go live.

## Local development

```bash
cp .env.example .env.local      # fill in values
npx prisma migrate deploy        # apply migrations to your local DB
npm run seed                     # admin user + categories
npm run dev
```

Local Postgres just needs a `DATABASE_URL` in `.env.local` (e.g.
`postgresql://you@localhost/snacksystem`). The card reader is optional — see
[CARD_READER.md](CARD_READER.md#testing-without-a-reader).
