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
