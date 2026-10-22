import { NextRequest, NextResponse } from "next/server";
import { requirePpp } from "@/lib/auth";
import { getActivitySumup } from "@/lib/activity-sumup";
import { costedActivityIds, resolvePppRange } from "@/lib/ppp-pl";

// SumUp card income for the dashboard P/L: summed over the range's borrels that
// have cost of goods uploaded (the same set the P/L's costs come from). Past
// borrels come from their saved snapshot; only today's/unsaved ones hit SumUp.
// GET /api/admin/ppp/stats/sumup?range=7d|30d|90d|365d|all|since_export
export async function GET(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { from } = await resolvePppRange(req.nextUrl.searchParams.get("range") ?? "90d");
  // The SumUp account is Stress's: only Stress borrels (none for a Dimensie login).
  if (ctx.scope === "dimensie") return NextResponse.json({ available: false });
  const ids = await costedActivityIds(from, "stress");

  let revenueCents = 0;
  let saved = 0;
  let live = 0;
  let missing = 0;
  // Sequential: an unsaved borrel fans out into per-transaction SumUp requests.
  for (const id of ids) {
    const s = await getActivitySumup(id);
    if (!s) {
      missing++;
      continue;
    }
    revenueCents += s.revenueCents;
    if (s.source === "saved") saved++;
    else live++;
  }

  if (ids.length > 0 && missing === ids.length) return NextResponse.json({ available: false });
  return NextResponse.json({ available: true, revenueCents, activities: ids.length, saved, live, missing });
}
