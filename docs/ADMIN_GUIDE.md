# Admin Guide (for the board)

Everything board members need for day-to-day operation. Log in at **`/admin`**
with the board credentials. The left sidebar has Dashboard, Members, Products,
and Invoices, plus links back to the Kiosk and Log out.

## Dashboard

A sales overview with a timeframe selector (**7 days / 30 days / 90 days / 1 year
/ All time**):
- **KPIs:** Revenue, Active users, Orders, Items sold, Average order. *Active
  users* counts the distinct members who made at least one purchase in the period.
- **Revenue over time:** a daily bar chart (hover a bar for the date and amount).
- **Most popular items:** ranked by quantity, with revenue per item.
- **Top spenders:** the 10 members who spent the most in the period, with their
  total spend and order count.
- **Recent purchases:** a live feed of the latest orders in the period — which
  member bought which items, the order total, and how long ago.

All figures count **confirmed and exported** purchases in the chosen period.

## Members

- **Search** by name or email.
- **Sync from Congressus** — imports/updates all Primary & Secondary members. Run
  this whenever membership changes (new members, status changes). Inactive
  members are flagged and cannot link cards. Members **no longer in Congressus**
  (removed there, or no longer a Primary/Secondary member) are cleaned up: those
  with no purchases are **removed**; those with purchase history are
  **deactivated** — they can't buy anymore, but their history and open invoice are
  kept. The result lists anyone who still has an **unexported balance**, so you can
  invoice them. Safety: if Congressus returns nothing or fewer than half the
  currently active members, the clean-up is skipped (nothing is removed).
- **📊 Dashboard** (or click the name) — the member's page: total spend split
  **SSS / PPP**, the **open invoice** (confirmed but not yet exported to
  Congressus), every past purchase (filter All / SSS / PPP; each marked Open or
  Exported), their **linked cards with UIDs**, and **🎟️ Edit roles** to add/remove
  roles (bar drink discounts) — saved immediately.
- **Lost card → Unlink** — on the member dashboard, **Unlink** removes just that
  card. It stops working immediately; the member and their history are kept. The
  member can link a new (or the found) card again via the normal flow.
- **🛒 Enter store** — opens the kiosk shop **as that member** so you can place an
  order on their behalf (e.g. manual sale). It behaves exactly like a card tap.
- **Delete** — removes a member, their cards and roles. Only possible once nothing
  is left to bill: unbilled orders must be exported to Congressus (or deleted) first.
  A member with past (exported) purchases is **anonymised** rather than erased:
  their personal details go, but their old orders stay as "Deleted member" so
  revenue and P/L figures don't change. If they're still in Congressus, the next
  sync adds them again as a fresh member (without their old history).

> Cards are normally linked by members themselves via the email flow — you don't
> link cards from the admin panel.

## Products

- **Categories** — at the top of the page, add a new category by typing a name and
  pressing **Add category**. Each chip shows how many products it holds; the **×**
  deletes a category, but only once it's **empty** (move or archive its products
  first). Use the **‹ ›** arrows on a chip to reorder categories — the order sets
  both the section order and the filter-pill order in the kiosk shop. Categories
  appear as the section headers and the filter pills in the kiosk shop.
- **Add product** — name, price (€), category, and optional stock (blank =
  unlimited). Creating a product also creates a matching Congressus product so it
  can appear on invoices. New products start as **Draft**.
- **Edit price** — click the price, type a new value, press Enter or **Save**.
  Price changes sync to Congressus.
- **Edit stock** — click the stock line under the product name to set a count
  (blank = unlimited). When stock reaches **0** the product is shown greyed-out
  with an **Out of stock** label in the kiosk — but members can **still buy it**
  (the count is a guide, not a hard block, in case it's wrong). **Stock decreases
  automatically** as products are bought (by the quantity in each confirmed
  order); it clamps at 0 and never goes negative, and unlimited products are
  unaffected. Set the count again when you restock.
- **Change category** — pick a different category from the dropdown on the product
  row; it moves immediately. Category is SSS-only (it doesn't affect Congressus).
- **Best before (expiry discount)** — set a best-before date on the product row.
  The price then drops automatically as it ages:
  - **final 7 days** (up to and including the best-before date) → **50% off**
    (kiosk shows a **-50%** badge),
  - **after the best-before date** → **free** (kiosk shows a **FREE** badge).

  The original price is struck through, and members are charged (and billed in
  Congressus) the discounted/zero price. Clear the date to remove the discount,
  and update it when a new batch arrives. *Note: products are not auto-hidden —
  an out-of-date product keeps being offered for free until you archive it or set
  a new date, so archive anything you no longer want given away.*
- **Image** — click the thumbnail to upload a photo (JPG/PNG/WebP/GIF).
- **Publish / Draft** — only **Published** products appear in the kiosk shop.
- **Archive** — hides a product you no longer sell.

## Invoices

Two tabs: **Pending export** (confirmed, awaiting billing) and **Exported**
(already sent to Congressus).

- **Edit** (pending only) — adjust line quantities with `−/+`, or set a line to 0
  to remove it; the total recalculates live. Use this when a member was charged
  for something by mistake or that wasn't actually in stock. **Save changes**.
- **Delete invoice** (pending only) — remove a whole invoice.
- **Export SSS + PPP to Congressus** (same button on the SSS and PPP invoices
  pages) — bills ALL pending snack and drink orders together: **one Congressus
  invoice per member per month** ("SSS & PPP <month>") with both their snacks and
  drinks, so each member gets one invoice and one direct debit. The orders then
  move to the Exported tab. Run this once per billing cycle (e.g. monthly).
- **⚠️ needs a check** — if Congressus didn't clearly answer (e.g. a timeout), the
  affected orders are locked and listed in a warning at the top. Check in Congressus
  whether that member has the invoice, then click **It's in Congressus → mark
  exported** or **Not in Congressus → back to pending**.
- **Clear all … (test data)** — bulk-deletes every invoice in the current tab,
  with a double confirmation. Use this to wipe test data so the dashboard counts
  fresh. **Irreversible.**

> Exported invoices are read-only here. They've been sent to Congressus, so
> corrections after export must be made in Congressus directly.

## Wall Street (bar)

Drink prices that move with demand, for a borrel game.

1. **Activities → Details / P&L → 📈 Wall Street mode.** Tick the drinks, choose the
   volatility (High is wild) and the floor/ceiling (default 50%–200% of the normal
   price), then **▶ Start Wall Street**.
2. Put **snacks.51vo.nl/wallstreet** on a screen at the bar (no login): a live graph
   of every drink's price, the current prices and a ticker tape.
3. Every 20 seconds prices update: what's being bought gets more expensive, the rest
   gets cheaper, plus random swings. The POS charges the market price shown on its
   tiles (member discounts still apply).
4. **💥 Crash (1 min)** — every drink at the bottom price for a minute. Fun at a
   chosen moment.
5. **■ Stop** at the end: normal prices again. (Closing the activity also stops it.)

## External cards (bar)

For external parties at a borrel: give them an **external card** — a bar card not
linked to any member.

- **PPP → External cards:** tap the card into the UID field, name it, **Add card**.
  (At the bar, a bartender can also scan an unknown card → **Not a member — use as
  external card**.)
- At the bar, drinks on that card go on the **borrel's external tab** (shown at
  internal prices; no specials or discounts). They are **not** billed via Congressus.
- After the borrel: **Activities → Details / P&L → External cards**. Enter a
  **Title** (e.g. the party's name and date), choose the **Price level** —
  Internal, Internal + 10%, Tussen (1.5×) or External (2×) — check the breakdown and
  **⬇ Download PDF**: title, borrel, every drink with unit and total prices excl. and
  incl. VAT, VAT per rate and the total. Send it to the party and invoice it
  yourself. Wrong taps can be removed under **Show orders**.
- **Profit:** only the drinks at **internal prices** count in the borrel's and the
  dashboard's profit/loss. The **markup** of Internal + 10%, Tussen or External on top
  of that is **AB profit** — shown separately as **AB Profit (via PPP)** on the PPP
  dashboard, never in the P/L.

## Typical monthly routine

1. **Members → Sync from Congressus** (catch new/changed members).
2. Check the **Dashboard** for the month.
3. **Invoices → Export SSS + PPP to Congressus** to bill the month's snacks and drinks.
4. Verify the new invoices in Congressus.

## Member-facing flows (what members experience)

- **Tap a registered card** → the shop opens, greets them by name, they pick
  snacks and confirm. It auto-returns to the tap screen after ~1 minute idle.
- **Tap an unregistered card** → they enter their **Stress website email** → they
  get a verification email → they click **Yes, link my card** on their phone →
  the card is linked. They then tap again at the kiosk to shop.
- **"Email not found"** → they typed an email that isn't a member's. They should
  use the email they log into the Stress website with. Persisting issues → board.
