// Canonicalize an NFC card UID so the SAME physical card maps to the SAME stored
// value regardless of cosmetic differences between readers. Used everywhere a UID
// is stored or looked up (scan, register, verify), so a card registered on one
// reader is recognised on another.
//
// Handled here (safe, format-independent):
//   • surrounding whitespace
//   • separators between bytes (":", "-", spaces) e.g. "AA:BB:CC:DD" → "AABBCCDD"
//   • letter case → uppercase hex
//
// NOT auto-handled (reader-dependent, can't be inferred from the string alone):
//   • BYTE ORDER — some readers emit the UID reversed (AABBCCDD vs DDCCBBAA)
//   • DECIMAL vs HEX — some readers emit the UID as a decimal number
// If your HID (iPad) reader differs from the Arago (laptop) reader in one of those
// ways, scan ONE known card on BOTH and add the deterministic transform in the
// marked spot below — this single function then keeps every device in sync.
// See docs/CARD_READER.md.
export function normalizeUid(raw: string): string {
  let uid = raw.trim().replace(/[\s:-]/g, "").toUpperCase();

  // ── Reader-format reconciliation (add here once the HID reader's format is
  //    known, so both readers produce the same canonical UID) ───────────────
  // e.g. reverse byte order:
  //   uid = (uid.match(/../g) ?? []).reverse().join("");
  // e.g. decimal → hex:
  //   if (/^\d+$/.test(uid)) uid = BigInt(uid).toString(16).toUpperCase();

  return uid;
}
