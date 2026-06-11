# Card Reader & Kiosk Setup

The kiosk supports two ways of getting a card UID into the page, chosen per
device:

| Mode | For | How the UID arrives |
|------|-----|---------------------|
| **`ws`** (default) | Laptop kiosk | [**Arago Card Reader**](https://github.com/SVArago/Arago-Card-Reader) broadcasts taps over a **WebSocket** |
| **`hid`** | **iPad / tablet** kiosk | A USB-C/Bluetooth NFC reader in **keyboard-wedge** mode "types" the UID + Enter |

Both feed the same `handleScan(uid)` → `POST /api/card/scan` flow. Pick the mode
with the **`?mode=` URL query** (per device) or the `NEXT_PUBLIC_CARD_READER_MODE`
env var (build default):
- Laptop: open the app normally (defaults to `ws`).
- iPad: open **`https://snacks.51vo.nl/?mode=hid`**.

## iPad / tablet kiosk (HID keyboard-wedge)

iPads have **no built-in NFC**, and Safari does not support the Web NFC API, so an
**external NFC reader is required**. Use a USB-C or Bluetooth reader configured as
a **keyboard-wedge (HID)**: on each tap it sends the card UID as keystrokes
followed by Enter. The kiosk page (in `?mode=hid`) listens for that burst on the
idle screen and treats it as a scan — no WebSocket, works in plain Safari.

Setup:
1. Pair/connect the HID NFC reader to the iPad and confirm it types the UID into a
   notes field followed by a newline.
2. Open **`/?mode=hid`** full-screen (Add to Home Screen / Guided Access works well).
3. The status dot shows a steady **"Ready to scan"** (there's no connection to
   monitor — the reader is just a keyboard).

> ⚠️ **UID format must match.** A card is matched by the exact UID stored when it
> was registered. If some cards are registered on the laptop (Arago) and others on
> the iPad (HID reader), make sure both output the UID in the **same format**
> (e.g. uppercase hex, same byte order), or a card registered on one won't be
> recognised on the other.

## Laptop kiosk (Arago WebSocket)

The Arago Card Reader runs on the kiosk laptop and **broadcasts card taps over a
WebSocket**; the kiosk web page connects to it instead of reading the card
directly.

## How it works

```
Physical card ──tap──▶ Arago Card Reader (laptop) ──WebSocket──▶ kiosk page (browser)
```

1. The Arago Card Reader runs locally and listens on a WebSocket port (default `3000`).
2. On each tap it broadcasts a JSON message:
   ```json
   { "atqa": "0004", "uid": "AABBCCDD", "sak": "08" }
   ```
3. The kiosk page (`src/app/page.tsx`) connects to `NEXT_PUBLIC_CARD_READER_WS_URL`,
   reads `uid`, and calls `POST /api/card/scan`.
4. A status dot (top-right of the kiosk) shows **Reader connected / Connecting… /
   Reader offline**, and the page auto-reconnects every 3 seconds.

## Kiosk laptop setup

1. **Run the production app in a browser**, full-screen/kiosk mode, pointed at the
   app's URL (`https://51vo.nl`).
2. **Run the Arago Card Reader** on the same laptop (follow its repo's
   instructions). Note the WebSocket port it uses.
3. **Point the kiosk at the reader.** The web page reads
   `NEXT_PUBLIC_CARD_READER_WS_URL`. Because this is a `NEXT_PUBLIC_*` variable it
   is **baked in at build time**, so the production build must already contain the
   right value.

### Port conflict warning
If you run the Next.js dev server **and** the reader on the same machine, they
can't both use port `3000`. Configure the reader on a different port (e.g.
`3001`) and set `NEXT_PUBLIC_CARD_READER_WS_URL=ws://localhost:3001`. In the
normal kiosk setup the app is served from Railway (not locally), so `3000` is
free for the reader.

### `ws://` vs `wss://`
The reader serves plain `ws://localhost:3000`. Because the kiosk connects to
`localhost`, browsers permit this even though the page itself is loaded over
HTTPS (localhost is treated as a secure context). Do not point the kiosk at a
remote `ws://` reader over the network — that would be blocked as mixed content.

## Card UIDs

- UIDs are normalised to **upper-case** before lookup/storage.
- A UID is not a secret — any NFC reader can read it. The system therefore never
  returns member data from the (public) scan endpoint and rate-limits it. See
  [SECURITY.md](SECURITY.md).

## Testing without a reader

You can exercise the shop without hardware by creating a `ShopSession` directly
and visiting `/shop/<token>`.

Option A — admin "Enter store":
1. Log in to `/admin`.
2. **Members** → find a member → **Enter store**. This creates a shop session and
   drops you into `/shop/<token>`.

Option B — a quick script (local DB):
```js
// node script using the same Prisma setup as src/lib/prisma.ts
const session = await prisma.shopSession.create({
  data: { memberId: someMember.id, expiresAt: new Date(Date.now() + 3600e3) },
});
console.log(`/shop/${session.token}`);
```

To simulate a tap end-to-end you can also `POST /api/card/scan` with a known,
registered UID and follow the returned token.
