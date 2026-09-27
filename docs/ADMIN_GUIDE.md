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
- **Delete** — removes a member and their linked cards. Blocked if the member has
  any invoices (delete/clear those first).

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
- **Export to Congressus** — bills all pending invoices. They are grouped into
  **one Congressus invoice per member per month** and then move to the Exported
  tab. Run this once per billing cycle (e.g. monthly).
- **Clear all … (test data)** — bulk-deletes every invoice in the current tab,
  with a double confirmation. Use this to wipe test data so the dashboard counts
  fresh. **Irreversible.**

> Exported invoices are read-only here. They've been sent to Congressus, so
> corrections after export must be made in Congressus directly.

## Typical monthly routine

1. **Members → Sync from Congressus** (catch new/changed members).
2. Check the **Dashboard** for the month.
3. **Invoices → Export to Congressus** to bill the month's purchases.
4. Verify the new invoices in Congressus.

## Member-facing flows (what members experience)

- **Tap a registered card** → the shop opens, greets them by name, they pick
  snacks and confirm. It auto-returns to the tap screen after ~1 minute idle.
- **Tap an unregistered card** → they enter their **Stress website email** → they
  get a verification email → they click **Yes, link my card** on their phone →
  the card is linked. They then tap again at the kiosk to shop.
- **"Email not found"** → they typed an email that isn't a member's. They should
  use the email they log into the Stress website with. Persisting issues → board.
