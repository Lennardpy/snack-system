# PPP — Bar POS (drinks at activities)

PPP extends SSS into a **bartender-operated point-of-sale** for selling drinks at
association activities ("borrels"). Bartenders open an activity, build a cart of
drinks, identify the member (card tap, or a one-tap "regulars" button), and
confirm. Orders are batched into **monthly Congressus invoices**, separate from
the snack (SSS) invoices.

It reuses the SSS foundation: the **same `Member` and `Card` tables** (a card
linked at the snack kiosk works at the bar with no re-registration), the same
session/auth model, the same Congressus client, and the same card-reader hook.

```
  Member card ──tap──▶ Bar POS ──confirm──▶ PppInvoice ──monthly──▶ Congressus ("PPP <month>")
```

## Surfaces

| Path | Who | Purpose |
|------|-----|---------|
| `/ppp/login` | public | Bartender sign-in: email/password **or scan a linked card** |
| `/ppp` | bartender/admin | Activity selector — auto-imports scheduled borrels from Alexia, open one or create your own; **Log out** |
| `/ppp/<activityId>` | bartender/admin | The POS screen (cart, scan, regulars, specials toggle, **Log out**) |
| `/admin/ppp/*` | admin | Management: dashboard, drinks, activities, roles, bartenders, invoices |

Roles: `requireBartender()` allows `BARTENDER` **or** `ADMIN`. Admin-only PPP
management uses `requireAdmin()`. Middleware gates `/ppp` and `/api/ppp`
(`/ppp/login` is public).

## The POS screen (`/ppp/<activityId>`)

A two-column touch UI plus a bottom "regulars" bar:

- **Left** — category tabs + a grid of drink tiles (tap to add). Tiles can carry a
  background **colour** and show a **SPECIAL** badge + struck price when an
  activity special is active.
- **Right** — the cart: the member being charged (with their role-discount chips),
  line items with big `− qty +` steppers, the live total (struck gross + final),
  and a large **Confirm** button. **Clear cart** sits at the top of the cart.
- **Header** — back, activity name/status, a **Specials ON/OFF** toggle (when the
  activity has specials), the reader status dot, and a **Log out** button.
- **Bottom (left column)** — **Regulars**: large circular buttons of members who
  have ordered at this borrel, most orders first. Tap one to charge them **without
  scanning** a card.
- **History tab** — live order feed for the activity (polls every 10 s).

Identifying the member (three ways, all set the same "charge target"):
1. **Card scan** — `POST /api/ppp/card/scan` (same `Card → Member` lookup as the
   kiosk); returns the member name + roles so discounts show before confirming.
2. **Regulars button** — one tap, no scan.
3. The bartender can **Change** at any time.

Card reader: uses the shared `useCardReader` hook (`src/lib/useCardReader.ts`) —
**`ws`** (Arago WebSocket, default in production), **`hid`** (keyboard-wedge), or
**`nfc`** (the device's own NFC chip via Web NFC), chosen by
`NEXT_PUBLIC_PPP_CARD_READER_MODE` / `?mode=` query, same as the kiosk.

### Android phone as an NFC kiosk (`?mode=nfc`)

For **outside borrels** where there's no laptop + Arago reader, any Android phone
can be the POS: just open `https://snacks.51vo.nl/ppp/login` in **Chrome or Edge
on Android** — the reader **auto-selects `nfc`** on any device that supports Web
NFC (only Chromium-on-Android exposes `NDEFReader`), so no `?mode=` query is
needed. Members' cards are read by the phone's built-in NFC chip via the
[Web NFC API](https://developer.mozilla.org/en-US/docs/Web/API/Web_NFC_API)
(`NDEFReader`); it reads the tag's **serial number**, which flows through the
exact same `onScan → normalizeUid → Card` lookup as every other reader. (You can
still force a mode with `?mode=ws|hid|nfc` — an explicit query always wins, so an
Android device driving a HID reader would use `?mode=hid`.)

Requirements & behaviour:
- **Chrome/Edge on Android only, over HTTPS.** Web NFC does not exist on iOS
  Safari or desktop browsers — there the button self-disables and the status reads
  *"Web NFC not supported (use Chrome on Android)."*
- **User gesture to arm.** The browser only lets a page start NFC after a tap, so
  the POS/login shows an **"Enable NFC scanning"** button. Tap it once per session,
  grant the NFC permission prompt, then hold cards to the back of the phone.
- **Fully additive.** `nfc` is entered only when selected; the `ws` WebSocket and
  `hid` keyboard listeners are untouched, so switching the phone to `?mode=nfc`
  can't affect the laptop or iPad readers.
- **Byte-order caveat.** Web NFC reports the UID in tag-read order, which *may*
  differ from the Arago reader's byte order for the same card. If a card that
  works on the laptop isn't recognised on the phone, scan one known card on both
  and add the deterministic transform in `normalizeUid()` (`src/lib/card.ts`,
  which already documents the spot). See [CARD_READER.md](CARD_READER.md).

## Pricing & discounts

Several discount mechanisms stack in a defined order. The shared logic lives in
`src/lib/roles.ts` and is applied **identically in the POS (display) and the
invoice route (authoritative)** — the client never sets prices.

### Member roles (`MemberRole`)
A member can hold several roles (Board, PilsCie, Bartenders, …). Each role grants
a **percentage** and/or a **fixed cents** discount (they stack within a role).
Across a member's roles, the **best (largest) discount amount per drink wins** —
so a fixed-cents role and a percentage role are always compared on the same
footing. Examples: Board = 100 % (free), PilsCie = €0.75 off, Bartenders = 25 %.

### Product special price (`PppProduct.specialPrice`)
An optional permanent promo price on a drink. When set, the member pays the
special price and **only percentage role discounts apply — fixed-cent discounts
are skipped** (so an already-discounted drink doesn't also get €0.75 off).

### Activity drink specials (`PppActivityDiscount`)
A per-borrel special price for specific drinks (e.g. **Flügel Friday** → Flügel
€1.00). Configured per activity (see below). When active, an activity special
**overrides** the product price/specialPrice. Like product specials, only
percentage role discounts apply on top.

### The Specials toggle (`PppActivity.discountsActive`)
Specials often "run out" during the night. Bartenders flip **Specials OFF** in the
POS header (`PATCH /api/ppp/activities/[id] { discountsActive }`) to instantly stop
all of that activity's specials for everyone; drinks revert to their normal /
product-special price. Member role discounts are unaffected by this toggle.

**Effective unit price** (`activityDiscountedUnitPrice`):
```
base   = activitySpecial (if active)  ▸  product.specialPrice  ▸  product.price
isSpecial = base came from an activity or product special
price  = base − bestRoleDiscount(base, roles, ignoreFixed = isSpecial)   (never < 0)
```

### Discount reporting (budget per borrel)
Each invoice line **snapshots** its list price and the activity-special price that
applied (`PppInvoiceLine.listCents` / `specialCents`), so the discount given can be
reported accurately even after a special is toggled off mid-borrel. Two totals
(`sumLineDiscounts` in `roles.ts`) are shown on the admin Activities list, the
activity detail page, and **in a banner when an activity is closed**:
- **Specials discount** — only the activity drink specials: Σ (list − special) × qty.
- **Total discount given** — everything (specials + roles/free drinks): Σ (list − charged) × qty.

## Bartender accounts

Managed under **Admin → PPP → Bartenders**.

- **Create by email** — `POST /api/admin/ppp/bartenders` makes a `BARTENDER`
  `User` with an unusable random password and emails a **set-password link**. The
  link is a `PasswordSetupToken` that **never expires** and is **single-use**
  (consumed on completion). `/set-password` lets them choose a password and signs
  them in; "Reset/Resend link" re-issues a fresh token.
- **Link a member (card login)** — link a bartender to a `Member` (typeahead
  search) so they can sign in by **scanning their card**. `POST /api/auth/card-login`
  resolves a tapped UID → member → linked `BARTENDER`/`ADMIN` user → session. A
  card UID isn't a secret, so this is limited to staff-linked cards and
  rate-limited (it's a convenience, weaker than the password).

## Admin pages (`/admin/ppp/*`)

| Page | What |
|------|------|
| **Dashboard** | Financials (revenue, drinks sold, orders, borrels, drinkers, avg) + rankings: **top borrels** by revenue, **top drinkers** by drinks, most popular drinks. Range selector. |
| **Drinks** | PPP catalog: categories, create/edit/publish/archive drinks with price, **special price**, VAT, and a 5-colour **tile colour** picker. |
| **Activities** | List borrels (auto-synced from Alexia + manual), close/reopen, rename, revenue + order counts + **discount given** (specials / total), order list. **Closing** shows the discount totals. Each links to its detail page. |
| **Activity detail** (`/admin/ppp/activities/[id]`) | Manage the borrel's **drink specials** (pick a drink, set a special price) — can be done in advance for a future borrel. Shows order count + the two discount totals, and whether specials are active. |
| **Member roles** | Create/edit roles with a `%` and/or `€` discount. Highest wins. |
| **Bartenders** | Invite by email, set-password link, link to a member for card login, delete. |
| **Invoices** | PPP orders grouped by borrel; status filter; **Export PPP to Congressus**; delete/clear test data. |

Member **role assignment** is on the existing **Admin → Members** page (role chips
+ a toggle picker per member).

## Congressus

PPP drinks live in their own Congressus folder, separate from SSS snacks. See
[CONGRESSUS.md](CONGRESSUS.md) for the shared client and quirks.

- **PPP product folder id `8804`** (`webshop/ppp`, created via the API; hardcoded
  default, overridable with `CONGRESSUS_PPP_FOLDER_ID`). New drinks created in the
  admin Drinks page sync here and get a `congressusProductOfferId`.
- **VAT cannot be set via the API** — every shape (`vat_category {…}`,
  `vat_percentage`, …) returns HTTP 500 server-side, so PPP products sync **without
  VAT** (like SSS products, which are all unset). VAT is kept locally on
  `PppProduct.vatCategory`; set it in the Congressus UI if needed.
- **Two-invoice export** — `POST /api/admin/invoices/export { scope }` (`sss` |
  `ppp` | `all`) creates **separate** Congressus invoices per member per month: an
  `"SSS <month>"` invoice and a `"PPP <month>"` invoice. PPP line descriptions
  include the activity name (`"Pils – Borrel 28 jun"`); same product at different
  activities/prices stays on separate lines. Both reuse `createSaleInvoice()` and
  the Mendix fallback for lines without an offer id.

## Alexia integration (scheduled borrels)

The drinks committee schedules borrels in **Alexia** (Inter-Actief's system,
`alex.ia.utwente.nl`). PPP imports them so bartenders don't retype names and admins
can prepare specials in advance. Logic in `src/lib/alexia.ts`.

- **Public, no auth** — Alexia's `event.upcoming_list` JSON-RPC method is public:
  `POST https://alex.ia.utwente.nl/api/1/` with
  `{"jsonrpc":"2.0","method":"event.upcoming_list","params":[true],"id":1}`. Events
  carry `name`, `organizer`, `locations`, `starts_at`, `ends_at` — but **no id**.
- **Auto-sync** — `POST /api/ppp/alexia/sync` keeps only `organizer === "Stress"`
  and **find-or-creates** a `PppActivity` for each (date = `starts_at`), matched by
  **name + calendar day** (no id exists). It runs when a bartender lands on `/ppp`
  **and** when an admin opens **Admin → PPP → Activities**, so new borrels appear
  automatically and the admin can pre-set specials on future ones.
- **Idempotent + fail-soft** — re-syncing creates nothing new; any Alexia
  error/timeout just yields no import and PPP keeps working.
- **Caveat** — because matching is name + day, **renaming** an auto-imported
  activity makes the next sync re-create the original (a duplicate). A stable Alexia
  reference field would need a schema change.

Configurable via `ALEXIA_API_URL` and `ALEXIA_ORGANIZER` (default `Stress`).

## Data model (PPP)

See [DATA_MODEL.md](DATA_MODEL.md) for the full schema. PPP adds:

- `PppProductCategory`, `PppProduct` (price, `specialPrice?`, `color?`,
  `vatCategory`, Congressus ids), `PppActivity` (`status`, `discountsActive`),
  `PppActivityDiscount` (per-activity per-product special price),
  `PppInvoice` (defaults to CONFIRMED, no CONCEPT), `PppInvoiceLine` (`unitCents`
  charged + `listCents?` / `specialCents?` snapshots for discount reporting).
- `MemberRole` (`discountPercent`, `discountCents`) ↔ `Member` (many-to-many).
- `PasswordSetupToken` (bartender invites; non-expiring, single-use).
- Reuses `User.memberId` to link a bartender to a member; reuses `Member` / `Card`
  unchanged for identity.

## API reference (PPP)

**Bartender** (`requireBartender`):

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/ppp/activities` | List / create activities |
| GET/PATCH | `/api/ppp/activities/[id]` | Activity + specials + `discountsActive` / toggle, close, rename |
| GET | `/api/ppp/activities/[id]/customers` | Regulars (members who ordered, most first) |
| POST | `/api/ppp/alexia/sync` | Import upcoming Stress borrels from Alexia |
| GET | `/api/ppp/products` | Published drinks for the POS |
| POST | `/api/ppp/card/scan` | UID → member (name + roles) for charging |
| GET/POST | `/api/ppp/invoices` | Order history (`?activityId=`) / confirm an order |

**Public**:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/card-login` | Sign a bartender in by card (linked member) |
| GET/POST | `/api/auth/set-password` | Validate / consume a set-password token |

**Admin** (`requireAdmin`): `/api/admin/ppp/products`, `…/categories`, `…/roles`,
`…/bartenders` (+`/[id]`, `/[id]/resend`), `…/activities/[id]` (+`/discounts`),
`…/stats`, `…/invoices`; `/api/admin/members/[id]/roles`,
`/api/admin/members/search`; and `POST /api/admin/invoices/export { scope }`.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_PPP_CARD_READER_MODE` | `ws` (prod) | POS/login reader mode (`ws`, `hid`, or `nfc`). Per-device override via `?mode=`. |
| `NEXT_PUBLIC_PPP_CARD_READER_WS_URL` | `ws://localhost:3000` | POS WebSocket reader address. |
| `CONGRESSUS_PPP_FOLDER_ID` | `8804` | Overrides the PPP Congressus product folder. |
| `ALEXIA_API_URL` | `https://alex.ia.utwente.nl/api/1/` | Alexia JSON-RPC endpoint for borrel sync. |
| `ALEXIA_ORGANIZER` | `Stress` | Only import borrels with this organiser. |

Bartender invite + card-verification emails reuse `EMAIL_FROM` / `BASE_URL` (see
[DEPLOYMENT.md](DEPLOYMENT.md)).
