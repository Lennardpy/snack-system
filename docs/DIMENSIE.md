# PPP for SV Dimensie

This is a guide for the Dimensie board and treasurer. It describes how Dimensie uses PPP, the bar system Stress built for its borrels.
Dimensie members pay at the bar with their card, the same way Stress members do. Dimensie bills its own members through its own Congressus. Stress invoices Dimensie for what Dimensie members drink at the borrels the two associations hold together.

> Status: built on the `dimensie` branch and tested on a separate test environment with a fake Congressus and anonymised data. 

---

## In short

| | |
|---|---|
| **Where** | `ppp.51vo.nl`: the bar POS, plus the **PPP admin** at `ppp.51vo.nl/ppp/admin` |
| **Your login** | A Dimensie admin login, which only ever shows Dimensie's data, plus bartender logins for your bartenders |
| **Joint borrels** | The Thursday **Weekly Drink**: Stress hosts and pays the bar, Stress prices apply, and both associations' members pay with their card |
| **Your own borrels** | Borrels Dimensie organises in Alexia. You set your own drink list and prices, and only Dimensie members can pay |
| **Billing your members** | One invoice per member per export in **your** Congressus, collected by direct debit, **without VAT** |
| **Stress → Dimensie** | After each Dimensie export, Stress receives a specification of the joint-borrel drinks you billed. Stress's treasurer sends you an invoice with that specification attached |

---

## The three kinds of borrel

| Borrel | Who hosts / pays the bar | Prices | Who can pay at the bar |
|---|---|---|---|
| **Joint**, the Thursday Weekly Drink | Stress | Stress's drink list | Stress **and** Dimensie members |
| **Dimensie** | Dimensie | Dimensie's own drink list | Dimensie members only |
| **Stress** | Stress | Stress's drink list | Stress members only |

- **Where borrels come from:** borrels are imported automatically from **Alexia**. Events organised by "Dimensie" become Dimensie borrels. A Stress "Weekly Drink" on a Thursday becomes a joint borrel.
- **Changing a borrel's type:** Stress can switch a Stress borrel to joint or back if needed. You can also create a borrel yourself at the POS, and it becomes a Dimensie borrel.
- **Who decides who pays:** the system decides from the card which membership pays. A bartender can't charge someone at a borrel where they're not allowed to pay.

## Cards, and people in both associations

- **Linking a card:** members don't need a new card. The first time a Dimensie member taps an unknown card at the bar, the bartender searches them by name and links it. After that the card works at every borrel where they can pay.
- **Members of both associations** are recognised by having the **same email** in both Congressus systems. They show up **once** in the bar search, with one card for both memberships.
  - At a **joint** or Stress borrel, their **Stress** membership pays. That way the drink doesn't go through Dimensie's invoice and then onto Stress's invoice to Dimensie.
  - At a **Dimensie** borrel, their **Dimensie** membership pays.
  - If they leave one association, the card keeps working for the other.
- **If the emails differ** between the two Congressus systems, the system treats them as two different people. Contact Stress if that happens.
- **Seeing cards:** the Dimensie admin sees the cards of its members, including members who are also in Stress, and can unlink a lost card.

## What you manage in the PPP admin

Sign in at `ppp.51vo.nl` with your Dimensie admin login. The admin shows the Dimensie logo and only Dimensie's data.

| Page | What you do there |
|---|---|
| **Dashboard** | Revenue, drinks and drinkers for Dimensie: your own borrels, plus what your members drank at joint borrels |
| **Borrels** | Your borrels: orders, profit/loss, specials. You enter SBZ usage for the cost of goods. Joint borrels are shown **view only**, with only your members' orders |
| **Invoices** | Your members' orders. **Export Dimensie to Congressus** sends them to your Congressus |
| **From Stress** | The specifications behind Stress's invoices to Dimensie, after Stress's treasurer has sent them |
| **Members** | Dimensie members: **Sync Dimensie** imports them from your Congressus. Also cards and roles per member |
| **Member roles** | Your own discounts, for example a board that drinks free. **Dimensie pays for these discounts**: Stress invoices the normal price |
| **Bartenders** | Your bartender accounts. They sign in at the POS and see Dimensie borrels and joint borrels |
| **Drinks** | Your drink list for **your own** borrels, without VAT. Joint borrels always use Stress's list |
| **SBZ prices** | The SBZ price list, maintained by Stress and **view only** for you. It is used to cost your borrels |

**What you won't see:**
- the snack kiosk 
- Stress's members, borrels, orders, roles or bartenders;
- Stress's figures;
- external cards, SumUp and Wall Street, which are only used at Stress borrels.

## Billing your members (export to Congressus)

**PPP admin → Invoices → Export Dimensie to Congressus** sends all pending drink orders of Dimensie members, from both Dimensie and joint borrels, to **Dimensie's Congressus**.

- **The invoices:**
  - one invoice per member per export, with reference **"Borrels <month>"**;
  - invoice workflow **309**, collected by **direct debit**;
  - **no VAT**.
- **Products in your Congressus:** every drink on an invoice needs a product in your Congressus. These are created automatically the first time a drink is exported, in a top-level folder **"PPP"**, without VAT. The 19 current Stress drinks (for the joint borrel) already exist there.
- **Safeguards:**
  - an order can never be exported twice;
  - a member whose drinks were all free (for example through a 100% role) gets no €0 invoice;
  - if Congressus doesn't answer clearly, the orders are listed under **"needs a check"**. Look them up in Congressus and mark them as exported, or put them back to pending.
- **Which members are synced:** **Sync Dimensie** imports members with the statuses **Lid** and **Extraordinary member**. Someone who is no longer in your Congressus is removed or, if they still have orders, deactivated.

## The specification from Stress (joint borrels)

At joint borrels Stress pays the bar, and Dimensie collects from its own members. So Stress invoices Dimensie for what Dimensie members drank there.

- **When it's made:** a specification is created **automatically each time Dimensie exports**. It covers the joint-borrel drinks that Dimensie has billed to its members in that export, and those orders are locked. Stress therefore specifies exactly what Dimensie billed.
- **Prices:**
  - the **normal drink price before Dimensie's own member discounts**; specials and Wall Street prices count. Dimensie pays for its own discounts;
  - **including VAT**, split into **VL 9%** and **VH 21%**;
  - free drinks for Dimensie bartenders at the joint borrel are **not** on it. Stress covers those.
- **What it contains:**
  - per borrel, each member with the drinks they had there and their subtotal;
  - a subtotal per borrel;
  - at the end the total, split into VL and VH.
  - There's also a CSV with one row per purchase.
- **How you receive it:** Stress's treasurer makes the actual invoice, attaches the specification, and books and sends it to `treasurer@svdimensie.nl`. The system itself sends nothing.
- **Where you can see it:** once the specification is sent, it also appears under **From Stress**, where you can download the PDF and CSV.


## Privacy and security

- **Separate data:** a Dimensie login only sees Dimensie's data. If someone asks for a Stress record by id, the system answers as if it doesn't exist. The same applies the other way round.
- **Shared bar view:** at the joint borrel, the bartenders of both associations see each other's members' names in the shared order history. Card numbers are visible to both associations for people who are in both.
- **Separate logins:** the snack system (`snacks.51vo.nl`) and the bar system (`ppp.51vo.nl`) each have their own login, and a session from one doesn't work on the other. Accounts are created per association by Stress's overall admin.
- **Your Congressus API key:** stored only as a server setting, never in the code. It's used for the following:
  - reading members with the two statuses above;
  - reading and creating products in the "PPP" folder;
  - creating sale invoices.
- **Where the data lives:** in a database at Railway (EU West, the Netherlands). The code is on GitHub (`Lennardpy/snack-system`) and contains no keys or personal data.
- **Security review:** Details are in [SECURITY.md](SECURITY.md).

