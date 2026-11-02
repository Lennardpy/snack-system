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
- its own **members**, synced from your Congressus (including IBAN, BIC and student number);
- its own **borrels**;
- its own **drinks**, for Dimensie borrels;
- its own **discount roles**;
- its own **bartenders**;
- the **export** of what your members owe, as an Excel sheet.

Joint borrels are shown read-only. Stress's data isn't visible to Dimensie, and the reverse also holds.

## Billing your members

**Invoices → Export Dimensie (Excel)** downloads a sheet with one row per member: First Name, Last Name, Email, IBAN, BIC, Event ("Drink costs October 2026"), Event price (their total) and Student number. You collect from your members with it yourself. It covers drinks at both Dimensie and joint borrels, without VAT, at the price each member was charged at the bar, including your own discounts. Earlier sheets stay available under **Dimensie exports**.

The dashboard shows what's still to bill, the last export, the latest invoice from Stress, and how many members have no IBAN in Congressus.

## Your members' own overview

Members can log in at **`ppp.51vo.nl/user`** with their Dimensie Congressus account. They see what they still owe, their spending per month, all their purchases, and each invoice as a PDF with the Dimensie logo. If a member asks about an invoice, a board member can also download that PDF from the member's page in the admin.

To enable the login, Dimensie registers the portal once as an OAuth client in its Congressus (redirect URI `https://ppp.51vo.nl/api/user/oauth/callback`) and gives Stress the client id and secret.

## Invoice from Stress

Each Dimensie export also creates a specification of the joint-borrel drinks you just billed. Stress's treasurer sends Dimensie an invoice with that specification attached.
- **Prices:** the drink price before Dimensie's own discounts, so Dimensie pays for its own discounts. The amounts include VAT.
- **Not included:** Dimensie bartenders' free drinks; Stress covers those.

You can also find the specification under **From Stress** in the admin.

## Privacy

Each association only sees its own data. At joint borrels, the bartenders of both associations share the order history. Dimensie's Congressus key is stored securely on the server and is only used to read members. IBANs and BICs are stored encrypted and only appear in the export sheet; please delete downloaded sheets once collection is done.

Questions: `treasurer@stress.utwente.nl`.
