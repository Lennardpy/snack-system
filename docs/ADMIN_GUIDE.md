# Admin Guide (for the board)

Everything board members need for day-to-day operation. Log in at **`/admin`**
with the board credentials. The left sidebar has Dashboard, Members, Products,
and Invoices, plus links back to the Kiosk and Log out.

## Dashboard

A sales overview with a timeframe selector (**7 days / 30 days / 90 days / 1 year
/ All time**):
- **KPIs:** Revenue, Orders, Items sold, Average order.
- **Revenue over time:** a daily bar chart (hover a bar for the date and amount).
- **Most popular items:** ranked by quantity, with revenue per item.

All figures count **confirmed and exported** purchases in the chosen period.

## Members

- **Search** by name or email.
- **Sync from Congressus** — imports/updates all Primary & Secondary members. Run
  this whenever membership changes (new members, status changes). Inactive
  members are flagged and cannot link cards.
- **🛒 Enter store** — opens the kiosk shop **as that member** so you can place an
  order on their behalf (e.g. manual sale). It behaves exactly like a card tap.
- **Delete** — removes a member and their linked cards. Blocked if the member has
  any invoices (delete/clear those first).

> Cards are normally linked by members themselves via the email flow — you don't
> link cards from the admin panel.

## Products

- **Add product** — name, price (€), category, and optional stock (blank =
  unlimited). Creating a product also creates a matching Congressus product so it
  can appear on invoices. New products start as **Draft**.
- **Edit price** — click the price, type a new value, press Enter or **Save**.
  Price changes sync to Congressus.
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
