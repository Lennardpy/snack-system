import { NextRequest, NextResponse } from "next/server";
import { requirePpp } from "@/lib/auth";
import { activityInScope } from "@/lib/scope-db";
import { getActivitySumup } from "@/lib/activity-sumup";

// SumUp card revenue for a borrel, per drink. Served from the stored snapshot once
// the borrel's day is over; fetched live while it's today/ongoing. Loaded
// separately from the detail so the page stays snappy and can show a spinner.
// `?refresh=1` re-fetches from SumUp and overwrites the snapshot.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await activityInScope(id, ctx.scope))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  // The SumUp account is Stress's: its card payments only belong to Stress borrels.
  if (!(await activityInScope(id, "stress"))) return NextResponse.json({ available: false });
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const result = await getActivitySumup(id, { refresh });
  if (!result) return NextResponse.json({ available: false });
  return NextResponse.json({ available: true, ...result });
}
