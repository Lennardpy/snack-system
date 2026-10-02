# Security Model

The guiding rule: **no member or internal data is reachable without a valid
session.** This document explains how that's enforced and the deliberate
trade-offs made for a shared, physical kiosk.

## Authentication & authorisation

### Admin
- Login (`POST /api/auth/login`) verifies a bcrypt password and sets an
  **httpOnly**, **Secure** (in production), `SameSite=Lax` `session` cookie
  (7-day `Session` row, `kind: "password"`). All logins go through
  `createSession()` / `setSessionCookie()` in `src/lib/auth.ts`.
- `requireAdmin()` (`src/lib/auth.ts`) loads the session, checks it isn't expired,
  and checks `role === "ADMIN"`. **Every** `/api/admin/*` handler calls it.
- The admin pages are gated by a **server-side layout** (`requireAdmin()` →
  `redirect("/admin/login")`), so unauthenticated users never receive page HTML
  or data — only a redirect.
- Middleware (`src/middleware.ts`) additionally requires the cookie to be present
  on `/admin/*` and `/api/admin/*`. This is a fast pre-check; the real validation
  is `requireAdmin()` (a forged/expired cookie passes middleware but is rejected
  by the handler).

### Bar POS (bartenders)
- **Card login** (`POST /api/auth/card-login`) creates a short `kind: "card"`
  session: **sliding 2 h** — each request extends it (the open POS polls every
  10 s, so it stays alive while in use) — and **never longer than 16 h** after the
  tap. A card login therefore can't linger on the shared bar PC into the next
  borrel. (Before this, all sessions lasted 7 days, so last week's login expired
  in the middle of the next weekly borrel, making charges fail with "Unauthorized".)
- When the session ends while the POS is open, the POS shows **"Session ended — tap
  a bartender card"**; the next tap signs in again in place, keeping the cart and
  selected member. A fresh page load with an ended session redirects to the login.
- Plus the client-side idle sign-out after 1 h without orders (see PPP.md).

### Shop (members)
- A `ShopSession` token (random cuid) is created only by a **physical card tap**
  or an admin's **Enter store**. It lives in the `/shop/<token>` URL.
- `/api/cart` and `/api/orders/confirm` require a valid, unexpired token.
- The member's first name is returned **only** by the token-scoped cart endpoint —
  never by the public scan endpoint.
- **Idle auto-reset:** the shop page deletes the session and returns to the tap
  screen after ~60 s of inactivity (with a 15 s warning), so a member who walks
  away can't leave their account open for the next person.

### Card verification
- `CardRegistration` tokens are single-use and expire in 15 minutes.
- **GET shows, POST acts:** the verification link is a GET that only renders a
  confirmation page; the card is linked only by the subsequent POST. This defeats
  **email-client link pre-fetching** (Gmail/Outlook/Apple Mail fetch links to
  scan them) — a GET that performed the action would link the card before the
  member clicked.

## Public endpoints — and why they leak nothing

| Endpoint | Exposure control |
|----------|------------------|
| `GET /api/products` | Only published products, **trimmed** to id/name/price/image/stock/category — no internal Congressus ids or timestamps. |
| `POST /api/card/scan` | Returns only an opaque token; **never** member data. Rate-limited 30/min/IP. |
| `POST /api/card/register` | Rate-limited 10/min/IP. |
| `GET /api/images/products/*` | Product images only (non-sensitive); path-traversal guarded. |
| `GET /api/health` | No data. |

## Rate limiting

`src/lib/rate-limit.ts` is an in-memory sliding-window limiter keyed by client IP
(from `x-forwarded-for`). Applied to `login` (10/min), `card/scan` (30/min), and
`card/register` (10/min). It is per-instance; for multi-instance scaling, swap for
a shared store (e.g. Redis).

## Injection & output safety

- React escapes all interpolated values in the kiosk/shop/admin pages.
- The card-verify pages are **hand-built HTML**, so member names and tokens are
  passed through `escapeHtml()` before interpolation (prevents stored XSS from a
  name synced out of Congressus).
- Those pages declare `charset=utf-8` (header + meta) so emoji/diacritics render
  correctly.

## HTTP security headers
Set for every response in `next.config.ts`: `Strict-Transport-Security`
(1 year, includeSubDomains), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` and a
CSP with `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`. Token-bearing
routes (`/api/card/verify`, `/api/auth/*`, `/set-password`, `/shop/*`) add
`Cache-Control: no-store`. (A full script CSP needs nonces for Next's inline
scripts — not done yet.)

## Deliberate trade-offs

### Card UIDs aren't secret
Any NFC reader can read a card UID, and the scan endpoint is necessarily
unauthenticated (the kiosk is a public web page). Mitigations: the scan endpoint
returns no member data and is rate-limited. For stronger protection, restrict
`/api/card/scan` to the kiosk's IP at the network layer.

### "Email not found" vs enumeration
The card-registration flow tells a user when their email matches no member
("Email not found"). This **re-introduces some email-enumeration ability** that a
uniform response would prevent. It was a conscious product choice: confused
members not knowing why nothing happened is a real problem at a kiosk, the kiosk
is physical, and the endpoint is rate-limited. If enumeration resistance becomes
more important than this UX, revert `card/register` to a uniform `{ ok: true }`.

### Shop token is a bearer token in the URL
Anyone holding a live `/shop/<token>` URL can act as that member until it expires
(10 min) or the order is confirmed. Tokens are random and per-tap (a new one each
scan), so they can't be guessed or reused. The idle auto-reset and short lifetime
bound the exposure. Stronger options (not currently implemented): move the token
into an httpOnly cookie so it can't be shared via URL, or use a crypto-random
token instead of a cuid.

## Prohibited / careful operations

- **Member deletion** is blocked while invoices exist.
- **Invoice edit/delete** is blocked once an invoice is `EXPORTED` (already billed
  in Congressus) or `EXPORTING`.
- **Export is never duplicated:** each export run atomically claims the orders it
  exports (`CONFIRMED → EXPORTING` + run id) before calling Congressus, so a
  concurrent run, double-click or retry can't bill them again. If the outcome is
  unknown (timeout, 5xx, crash, DB write failure after success) the orders stay
  `EXPORTING` and the invoices pages show a **"needs check"** warning; an admin
  checks Congressus and resolves them (mark exported / back to pending) — allowed
  only 10+ minutes after the claim. A clear rejection (4xx) returns them to pending
  automatically.
- **Bulk invoice clearing** requires a double confirmation in the UI and is
  intended for test-data cleanup only.

## Audit checklist

When adding a new endpoint:
- [ ] Does it touch member/admin data? → call `requireAdmin()` (admin) or validate a token (shop/registration).
- [ ] Does it return more fields than the caller needs? → `select` only what's required.
- [ ] Is it public and write-capable or enumeration-prone? → add rate limiting.
- [ ] Does it render raw HTML with external data? → escape it.
- [ ] Verify at runtime: unauthenticated **and** forged-cookie requests both get 401/redirect.
