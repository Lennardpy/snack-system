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
| `CONGRESSUS_API_TOKEN_DIMENSIE` | – | – | Bearer token for SV Dimensie's Congressus. Without it the Dimensie sync/export is unavailable. Never give staging a real token. |
| `CONGRESSUS_PRODUCT_OFFER_ID` | – | `118389` | Fallback "SSS purchases Mendix" product offer id used when a product has no offer id. |
| `RESEND_API_KEY` | ✅ | `re_…` | Resend API key for verification emails. |
| `EMAIL_FROM` | ✅ | `Stress Snack System <snacks@51vo.nl>` | From address (Resend-verified domain). **Not** a `no-reply@` address. |
| `EMAIL_REPLY_TO` | – | `board@51vo.nl` | Optional reply-to so members can respond / it isn't one-way. |
| `BASE_URL` | ✅ | `https://snacks.51vo.nl` | **Server-side** public URL. Used in email links and the verify form action. **Must be on the same domain you email from** (51vo.nl) or links get flagged. |
| `NEXT_PUBLIC_BASE_URL` | ✅ | same as `BASE_URL` (`https://snacks.51vo.nl`) | Client-visible URL. |
| `NEXT_PUBLIC_CARD_READER_WS_URL` | – | `ws://localhost:3000` | WebSocket the kiosk connects to for card taps (`ws` mode). Baked into the client bundle at build time. |
| `NEXT_PUBLIC_CARD_READER_MODE` | – | `ws` (or `hid`) | Default input mode: `ws` (Arago WebSocket) or `hid` (keyboard-wedge NFC reader, e.g. iPad). Override per device with the `?mode=` URL query. |
| `NEXT_PUBLIC_PPP_CARD_READER_MODE` | – | `ws` (or `hid` / `nfc`) | PPP bar POS / login reader mode (independent of the kiosk). `ws` (Arago), `hid` (keyboard-wedge), or `nfc` (the device's own NFC chip via Web NFC — Chrome/Edge on **Android** over **HTTPS**). Resolution: an explicit `?mode=` query wins, else **`nfc` is auto-selected on Android** (only Chromium-Android exposes `NDEFReader`), else this default. So an Android phone just needs `…/ppp/login` — and the auto-pick can't affect laptop (`ws`) or iPad (`hid`) devices, which don't support Web NFC. |
| `NEXT_PUBLIC_PPP_CARD_READER_WS_URL` | – | `ws://localhost:3000` | PPP POS WebSocket reader address. Baked at build time. |
| `CONGRESSUS_PPP_FOLDER_ID` | – | `8804` | Overrides the PPP (drinks) Congressus product folder. See [PPP.md](PPP.md). |
| `ALEXIA_API_URL` | – | `https://alex.ia.utwente.nl/api/1/` | Alexia JSON-RPC endpoint used to auto-import scheduled borrels (public, no auth). |
| `ALEXIA_ORGANIZER` | – | `Stress` | Only borrels with this organiser are imported. |
| `SUMUP_API_KEY` | – | `sup_sk_…` | SumUp secret API key (Bearer token) for pulling card revenue into a borrel's profit/loss. Fail-soft if unset (card revenue shows "n/a"). |
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

### The PPP site (`ppp.51vo.nl`)
`ppp.51vo.nl` is the bar system's own site (POS + PPP admin), served by the same
service: `src/middleware.ts` routes by domain and redirects the other site's
paths (`snacks.51vo.nl/ppp…` → `ppp.51vo.nl/ppp…`). The domain needs wiring up
once, in two places:
1. Railway → the **snack-system** service → **Settings → Networking → Custom
   Domain** → add **`ppp.51vo.nl`** (target port **8080**, same as `snacks.51vo.nl`).
2. At the DNS provider (51vo.nl zone) add the **CNAME** record Railway shows for it
   (a per-domain `…up.railway.app` target). Wait for Railway to validate + issue
   the TLS cert.

Optional env vars `SSS_ORIGIN` / `PPP_ORIGIN` override the two sites' origins
(defaults `https://snacks.51vo.nl` / `https://ppp.51vo.nl`; staging sets its own).
Locally, `localhost:3000` is the SSS and `ppp.localhost:3000` the PPP. Each site
has its own login (host-only session cookie).

## Email deliverability (verification emails)

Verification emails go through **Resend** from `…@51vo.nl`. To stay out of spam:

- **SPF + DKIM** — set up by Resend's domain verification. Confirmed present:
  `resend._domainkey.51vo.nl` (DKIM) and `send.51vo.nl` (return-path SPF +
  feedback MX). Keep the Resend domain **Verified**.
- **DMARC (required)** — add a TXT record at **`_dmarc.51vo.nl`**:
  ```
  v=DMARC1; p=none; rua=mailto:dmarc@51vo.nl; fo=1
  ```
  Start with `p=none` (monitor only); once reports look clean, tighten to
  `p=quarantine` then `p=reject`. DKIM is domain-aligned (`d=51vo.nl`), so DMARC
  passes. Google/Yahoo/Microsoft now require a DMARC record to exist.
- **Link domain must match the sender** — the verify link must be on `51vo.nl`,
  not the Railway domain. This is why `BASE_URL`/`NEXT_PUBLIC_BASE_URL` are set to
  `https://snacks.51vo.nl`. A link to `*.up.railway.app` from a `@51vo.nl` sender
  looks like phishing and trips spam filters.
- **No `no-reply`** — use a real from-address (`snacks@51vo.nl`) and optionally
  `EMAIL_REPLY_TO`.

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
