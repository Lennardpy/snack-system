# PPP for SV Dimensie

PPP is the bar system Stress uses at its borrels. Dimensie members can pay at the bar with their card, just like Stress members. Dimensie bills its own members in its own Congressus. Stress invoices Dimensie for what Dimensie members drink at the joint borrels.

Everything runs at **`ppp.51vo.nl`**. Dimensie gets its own admin login, which only shows Dimensie's data, plus bartender logins.

## Borrels

| Borrel | Bar paid by | Prices | Who can pay |
|---|---|---|---|
| **Joint**, the Thursday Weekly Drink | Stress | Stress's | Stress and Dimensie members |
| **Dimensie** | Dimensie | Dimensie's own | Dimensie members |
| **Stress** | Stress | Stress's | Stress members |

Borrels are imported automatically from Alexia. Dimensie borrels are the ones with organiser "Dimensie".

## Cards

- **First use:** the first time a Dimensie member taps their card at the bar, the bartender links it to them by name.
- **Members of both associations:** they use one card. At joint borrels their Stress membership pays; at Dimensie borrels their Dimensie membership pays.

## What Dimensie manages

In the PPP admin (`ppp.51vo.nl/ppp/admin`), Dimensie manages:
- its own **members**, synced from your Congressus;
- its own **borrels**;
- its own **drinks**, for Dimensie borrels;
- its own **discount roles**;
- its own **bartenders**;
- the **export** to your Congressus.

Joint borrels are shown read-only. Stress's data isn't visible to Dimensie, and the reverse also holds.

## Billing your members

**Invoices → Export Dimensie to Congressus** creates one invoice per member in Dimensie's Congressus. It covers drinks at both Dimensie and joint borrels, is collected by direct debit, and has no VAT. Each member pays the price they were charged at the bar, including your own discounts.

## Invoice from Stress

Each Dimensie export also creates a specification of the joint-borrel drinks you just billed. Stress's treasurer sends Dimensie an invoice with that specification attached.
- **Prices:** the drink price before Dimensie's own discounts, so Dimensie pays for its own discounts. The amounts include VAT.
- **Not included:** Dimensie bartenders' free drinks; Stress covers those.

You can also find the specification under **From Stress** in the admin.

## Privacy

Each association only sees its own data. At joint borrels, the bartenders of both associations share the order history. Dimensie's Congressus key is stored securely on the server and is only used for members, products and invoices.

Questions: `treasurer@stress.utwente.nl`.
