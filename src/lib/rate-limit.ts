import { NextRequest } from "next/server";

// Simple in-memory sliding-window rate limiter.
// Adequate for a single Railway instance. For multi-instance, swap for Redis.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Periodically evict expired buckets to bound memory.
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt < now) buckets.delete(key);
  }
}

export function clientIp(req: NextRequest): string {
  // Railway/most proxies set x-forwarded-for: "client, proxy1, proxy2"
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Failed-attempt counter per key (e.g. per account): `failuresExceeded` checks
// without counting, `recordFailure` counts one, `clearFailures` resets (on a
// successful login). Only failures count, so the owner's normal logins don't use
// up the limit.
export function failuresExceeded(key: string, limit: number): boolean {
  const b = buckets.get(key);
  return !!b && b.resetAt >= Date.now() && b.count >= limit;
}
export function recordFailure(key: string, windowMs: number): void {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt < now) buckets.set(key, { count: 1, resetAt: now + windowMs });
  else b.count++;
}
export function clearFailures(key: string): void {
  buckets.delete(key);
}

// Returns true if the request is allowed, false if rate-limited.
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}
