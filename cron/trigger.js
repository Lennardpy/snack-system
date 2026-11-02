// Railway cron job for the month-end export (src/lib/monthly-export.ts). Runs at
// 10:00 and 11:00 UTC on the 1st (the service's cron schedule) — 12:00 Amsterdam in summer and in
// winter; the app only acts on the call that falls at 12:xx, once per month.
// Env: APP_URL (the app's internal or public URL), CRON_SECRET (same as the app's).
const url = `${(process.env.APP_URL ?? "").replace(/\/+$/, "")}/api/cron/monthly-export`;

async function main() {
  if (!process.env.APP_URL || !process.env.CRON_SECRET) throw new Error("APP_URL and CRON_SECRET must be set");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const text = await res.text();
  console.log(`[cron] ${res.status} ${text.slice(0, 2000)}`);
  if (!res.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[cron] failed:", err);
  process.exitCode = 1;
});
