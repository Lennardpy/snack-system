import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { fetchSumupBreakdown } from "@/lib/sumup";

// Live SumUp card revenue for a borrel, matched by its time window. Fetched
// separately from the detail so the page stays snappy and can show a spinner.
// Window = the activity's startsAt/endsAt (from Alexia) or, failing that, the
// whole `date` calendar day.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const activity = await prisma.pppActivity.findUnique({
    where: { id },
    select: { date: true, startsAt: true, endsAt: true },
  });
  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  let from = activity.startsAt;
  let to = activity.endsAt;
  if (!from || !to) {
    const day = new Date(activity.date);
    from = new Date(day);
    from.setHours(0, 0, 0, 0);
    to = new Date(from);
    to.setDate(to.getDate() + 1);
  }

  const result = await fetchSumupBreakdown(from.toISOString(), to.toISOString());
  if (!result) {
    return NextResponse.json({
      available: false,
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }
  return NextResponse.json({
    available: true,
    revenueCents: result.revenueCents,
    count: result.count,
    byDrink: result.byDrink,
    from: from.toISOString(),
    to: to.toISOString(),
  });
}
