import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Encryption for sensitive member data at rest (Dimensie members' IBAN and BIC):
// AES-256-GCM with the key in MEMBER_DATA_KEY — 32 bytes, base64 or hex. Generate
// one with `openssl rand -base64 32`. Losing the key only loses the stored bank
// details; the next member sync stores them again under the new key.
//
// Stored as "v1:<iv>:<auth tag>:<ciphertext>" (base64 parts).

function key(): Buffer | null {
  const raw = process.env.MEMBER_DATA_KEY?.trim();
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

export const secretBoxConfigured = () => key() !== null;

export function seal(plain: string): string {
  const k = key();
  if (!k) throw new Error("MEMBER_DATA_KEY is not set (32 bytes, base64 or hex)");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

// null when there's nothing stored, no key, or it can't be decrypted (wrong key,
// tampered) — callers treat that as "no bank details".
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const k = key();
  const [v, iv, tag, ct] = sealed.split(":");
  if (!k || v !== "v1" || !iv || !tag || ct === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// "NL91 •••• •••• 4300" — for showing that an IBAN is on file without revealing it.
export function maskIban(iban: string | null): string | null {
  if (!iban) return null;
  const s = iban.replace(/\s+/g, "");
  return `${s.slice(0, 4)} •••• ${s.slice(-4)}`;
}
