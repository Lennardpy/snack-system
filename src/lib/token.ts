import { randomBytes } from "crypto";

// A secret token for sessions and emailed links: 32 bytes from the OS's
// cryptographic random source, URL-safe. (Never Math.random / Prisma cuid().)
export const newToken = () => randomBytes(32).toString("base64url");
