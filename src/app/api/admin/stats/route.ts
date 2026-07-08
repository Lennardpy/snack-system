import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// GET /api/admin/stats?range=7d|30d|90d|365d|all|since_export
// Returns revenue, order/item counts, a daily revenue series, and top products
// over the chosen timeframe (based on confirmed sales). `since_export` = the still-
// unbilled orders (status CONFIRMED) so the admin sees what money is still to come.
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const range = req.nextUrl.searchParams.get("range") ?? "30d";
  const sinceExport = range === "since_export";

  let from: Date | null = null;
  let lastExportAt: Date | null = null;
  if (sinceExport) {
    const last = await prisma.saleInvoice.findFirst({
      where: { exportedAt: { not: null } },
      orderBy: { exportedAt: "desc" },
      select: { exportedAt: true },
    });
    lastExportAt = last?.exportedAt ?? null;
    from = lastExportAt; // drives the daily chart window (null => all days with data)
  } else {
    const days = range === "all" ? null : parseInt(range.replace("d", ""), 10) || 30;
    from = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
  }

  // Confirmed + exported invoices count as actual sales.
  const invoices = await prisma.saleInvoice.findMany({
    where: sinceExport
      ? { status: "CONFIRMED" } // unbilled = still to come
      : {
          status: { in: ["CONFIRMED", "EXPORTED"] },
          ...(from ? { confirmedAt: { gte: from } } : {}),
        },
    include: { lines: { include: { product: true } }, member: true },
    orderBy: { confirmedAt: "asc" },
  });

  let revenueCents = 0;
  let itemsSold = 0;
  const orderCount = invoices.length;

  // Top products: productId -> { name, quantity, revenueCents }
  const productMap = new Map<string, { name: string; quantity: number; revenueCents: number }>();

  // Spend per member: memberId -> { name, spentCents, orderCount }
  const memberMap = new Map<string, { name: string; spentCents: number; orderCount: number }>();

  // Daily revenue: "YYYY-MM-DD" -> cents
  const dayMap = new Map<string, number>();

  for (const inv of invoices) {
    revenueCents += inv.totalCents;
    const d = inv.confirmedAt ?? inv.createdAt;
    const dayKey = d.toISOString().split("T")[0];
    dayMap.set(dayKey, (dayMap.get(dayKey) ?? 0) + inv.totalCents);

    const memberEntry = memberMap.get(inv.memberId) ?? {
      name: `${inv.member.firstName} ${inv.member.lastName}`.trim(),
      spentCents: 0,
      orderCount: 0,
    };
    memberEntry.spentCents += inv.totalCents;
    memberEntry.orderCount += 1;
    memberMap.set(inv.memberId, memberEntry);

    for (const line of inv.lines) {
      itemsSold += line.quantity;
      const lineRevenue = line.quantity * line.unitCents;
      const entry = productMap.get(line.productId) ?? {
        name: line.product.name,
        quantity: 0,
        revenueCents: 0,
      };
      entry.quantity += line.quantity;
      entry.revenueCents += lineRevenue;
      productMap.set(line.productId, entry);
    }
  }

  const topProducts = [...productMap.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 8);

  // Top spenders + active users (distinct members with a purchase in range).
  const topSpenders = [...memberMap.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.spentCents - a.spentCents)
    .slice(0, 10);
  const activeUsers = memberMap.size;

  // Recent purchases feed — the latest orders in the range (who bought what).
  const recentPurchases = [...invoices]
    .sort(
      (a, b) =>
        (b.confirmedAt ?? b.createdAt).getTime() - (a.confirmedAt ?? a.createdAt).getTime(),
    )
    .slice(0, 5)
    .map((inv) => ({
      id: inv.id,
      memberName: `${inv.member.firstName} ${inv.member.lastName}`.trim(),
      at: (inv.confirmedAt ?? inv.createdAt).toISOString(),
      totalCents: inv.totalCents,
      items: inv.lines.map((l) => ({ name: l.product.name, quantity: l.quantity })),
    }));

  // Build a continuous daily series so the chart has no gaps.
  const series: { date: string; revenueCents: number }[] = [];
  if (from) {
    const cursor = new Date(from);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    while (cursor <= end) {
      const key = cursor.toISOString().split("T")[0];
      series.push({ date: key, revenueCents: dayMap.get(key) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    // "all" — just use whatever days have data, sorted
    [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([date, revenueCents]) => series.push({ date, revenueCents }));
  }

  return NextResponse.json({
    range,
    lastExportAt: lastExportAt ? lastExportAt.toISOString() : null,
    revenueCents,
    orderCount,
    itemsSold,
    avgOrderCents: orderCount > 0 ? Math.round(revenueCents / orderCount) : 0,
    activeUsers,
    topProducts,
    topSpenders,
    recentPurchases,
    series,
  });
}
