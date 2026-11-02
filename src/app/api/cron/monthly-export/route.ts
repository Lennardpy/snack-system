import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isScheduledMoment, runMonthlyExport } from "@/lib/monthly-export";

// POST /api/cron/monthly-export — called by the Railway cron job (Authorization:
// Bearer $CRON_SECRET). Runs the month-end export only on the 1st at 12:xx
// Amsterdam time (the job fires at both 10:00 and 11:00 UTC to cover summer and
// winter time), unless ?force=1. Each month runs at most once whatever triggers it.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secret.length < 16 || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isScheduledMoment()) {
    return NextResponse.json({ skipped: "Not the scheduled moment (the 1st, 12:00 Amsterdam)." });
  }
  const result = await runMonthlyExport();
  console.log("[monthly-export]", JSON.stringify(result));
  return NextResponse.json(result);
}
