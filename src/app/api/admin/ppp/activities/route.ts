import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// Full activity list for the admin panel: order counts + total revenue per
// activity, OPEN ones first.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [activities, revenue] = await Promise.all([
    prisma.pppActivity.findMany({
      orderBy: { date: "desc" },
      include: { _count: { select: { invoices: true } } },
    }),
    prisma.pppInvoice.groupBy({
      by: ["activityId"],
      _sum: { totalCents: true },
    }),
  ]);

  const revenueByActivity = new Map(revenue.map((r) => [r.activityId, r._sum.totalCents ?? 0]));

  const result = activities
    .map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      date: a.date,
      orderCount: a._count.invoices,
      revenueCents: revenueByActivity.get(a.id) ?? 0,
    }))
    // OPEN before CLOSED, preserving date order within each group.
    .sort((a, b) => Number(a.status === "CLOSED") - Number(b.status === "CLOSED"));

  return NextResponse.json({ activities: result });
}
