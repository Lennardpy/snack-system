import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { getWallstreet, runningWallstreetActivityId, wallstreetHistory } from "@/lib/wallstreet";

// PUBLIC — the Wall Street board (/wallstreet) and the POS poll this.
// ?activityId= picks an activity (the POS); without it, the running Wall Street.
// ?history=0 skips the price history (the POS only needs current prices).
// Exposes only drink names and prices.
export async function GET(req: NextRequest) {
  if (!rateLimit(`wallstreet:${clientIp(req)}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const sp = req.nextUrl.searchParams;
  const activityId = sp.get("activityId") ?? (await runningWallstreetActivityId());
  const state = activityId ? await getWallstreet(activityId) : null;
  const headers = { "Cache-Control": "no-store" };
  if (!state) return NextResponse.json({ active: false }, { headers });

  return NextResponse.json(
    {
      ...state,
      serverNow: new Date(),
      history: sp.get("history") === "0" ? undefined : await wallstreetHistory(state.activityId),
    },
    { headers }
  );
}
