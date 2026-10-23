# Security Model

The guiding rule: **no member or internal data is reachable without a valid
session.** This document explains how that's enforced and the deliberate
trade-offs made for a shared, physical kiosk.

## Authentication & authorisation

### Two sites, separate logins
- One app serves two sites, told apart by the domain (`src/lib/site.ts`): the
  **SSS** (snack system, `snacks.51vo.nl`) and the **PPP** (bar system,
  `ppp.51vo.nl`). The session cookie is host-only, and every `Session` row stores
  the `site` it was created on — `getSession()` rejects it on the other site, so a
  copied cookie doesn't work across domains either.
- Accounts (`User`) carry `sssAccess` / `pppAccess` (admins) and an
  `associationId` (null = the **overall admin**, who sees everything and manages
  accounts). Bartenders only use the PPP. Login (`POST /api/auth/login`) refuses an
  account without access to the site it signs in on.

### Admin
- Login verifies a bcrypt password and sets an **httpOnly**, **Secure** (in
  production), `SameSite=Lax` `session` cookie (7-day `Session` row, `kind:
  "password"`). All logins go through `createSession()` / `setSessionCookie()` in
  `src/lib/auth.ts`.
- Every `/api/admin/*` handler calls one of (`src/lib/auth.ts`):
  - `requireSss()` — snack-system routes (products, SSS invoices, SSS dashboard);
  - `requirePpp()` — bar routes; returns the login's **scope** (association);
  - `requireMemberAdmin()` — shared member routes (SSS → Stress members, PPP → its scope);
  - `requireStressExporter()` — the combined Stress export (SSS admin or a Stress-side PPP admin);
  - `requireOverallAdmin()` — account management.
- **Association scoping** (`src/lib/scope.ts`, `scope-db.ts`): PPP routes filter
  every list by the scope and answer **404** for a record of another association
  (so its existence isn't revealed). Stress-only parts (the drink list, external
  cards, SBZ edits, SumUp figures) refuse a Dimensie login. POS routes scope by the
  bartender's association (`posScope`).
- The admin pages are gated by **server-side layouts** (`requireSss()` →
  `/admin/login`, `requirePpp()` → `/ppp/login`), so unauthenticated users never
  receive page HTML or data — only a redirect.
- Middleware (`src/middleware.ts`) routes each domain to its own pages and requires
  the cookie on protected prefixes. This is a fast pre-check; the real validation
  is in the handlers (a forged/expired cookie passes middleware but is rejected).

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
| `GET /api/wallstreet` | The Wall Street board: only the running borrel's name and drink names/prices. Rate-limited 240/min/IP (a board + POS poll every few seconds). Can create at most one price tick per 20 s per activity (unique index). |

## Rate limiting

`src/lib/rate-limit.ts` is an in-memory sliding-window limiter keyed by client IP
(from `x-forwarded-for`). Applied to `login` (10/min), `card/scan` (30/min), and
`card/register` (10/min), and `wallstreet` (240/min). It is per-instance; for multi-instance scaling, swap for
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

## Audit: two sites + Stress/Dimensie (branch `dimensie`, October 2026)

Scope: everything the multi-association work added — site separation, logins,
association scoping, the POS rules, the Dimensie export and the specifications.

**How it was checked.** All 118 API handlers were listed with the access check they
call: every `/api/admin/*` and `/api/ppp/*` handler calls a `require…()` guard (101);
the 17 without one are the intended public / token endpoints (kiosk, card
registration, login, health, product images, product list, Wall Street board). Every
PPP handler that takes an id was checked for association scoping. Behaviour was
verified with scripted access-matrix tests (~170 checks: each login type × site ×
route, other-association ids → 404, joint-borrel read-only, exports, specifications)
against a local server and the mock Congressus, and on staging.

**Found and fixed**
- *Open redirect after login* (pre-existing): `?from=` on both login pages was
  followed unchecked → now only same-site paths (`src/lib/safe-path.ts`).
- *CSV formula injection*: member/drink/borrel names starting with `= + - @` (names
  come from Congressus, set by members) would run as formulas in Excel → prefixed
  with `'` in the purchases CSV.
- *External cards*: any PPP bartender could register an external card via the API
  (the POS only hid the button for Dimensie) → Stress-side staff only.
- *Host-based site detection*: the `ppp.localhost` derivation is now dev-only, so a
  forged `Host` can't influence redirects in production.
- Earlier in the branch: card login for someone in both associations, an inactive
  Stress membership blocking payment as Dimensie member, cards lost when a membership
  was deleted, SBZ editing UI shown to Dimensie (the API already refused it).

**Verified as designed**
- Sessions are per site (`Session.site`, host-only cookie); a cookie copied to the
  other domain is rejected. Login refuses accounts without access to that site — and
  only after the password matched (no account enumeration).
- A Dimensie login gets 404 for any Stress record (members, roles, bartenders, orders,
  borrels, drinks), can't see the SSS, SBZ edits, SumUp, Wall Street or external
  cards, and views joint borrels read-only (its own members' orders).
- Who pays where is resolved server-side from the card/member — the POS can't choose
  another membership or association. Prices come from the host's drink list only.
- Exports: each side only runs and resolves its own association's export; Stress's
  never claims Dimensie members' orders and vice versa. Specifications are created
  only from orders Dimensie exported; finalised orders are locked; Dimensie sees a
  specification only once Stress marked it sent.
- Secrets: no API keys in the repository or its history; per-association Congressus
  tokens live in Railway variables only. Staging uses a mock Congressus and an
  anonymised copy of the data.

**Accepted / by design**
- Card UIDs are visible to both associations' admins for people in both (cards
  belong to the person); bartenders at a joint borrel see each other's members'
  names in the shared order history.
- People in both associations are matched by email; different emails → two people.
- Set-password (invite) links don't expire (as for bartenders before); "Reset link"
  invalidates the previous one. Consider an expiry for admin invites later.

## Audit checklist

When adding a new endpoint:
- [ ] Does it touch member/admin data? → call the right `require…()` for its site (see above), scope it with `src/lib/scope.ts`, or validate a token (shop/registration).
- [ ] Does it return more fields than the caller needs? → `select` only what's required.
- [ ] Is it public and write-capable or enumeration-prone? → add rate limiting.
- [ ] Does it render raw HTML with external data? → escape it.
- [ ] Verify at runtime: unauthenticated **and** forged-cookie requests both get 401/redirect.
