import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { fetchSumupRevenueTotal } from "@/lib/sumup";

// Total SumUp card revenue for the dashboard's selected range. Loaded separately
// from the main stats so the dashboard stays snappy (external call).
// GET /api/admin/ppp/stats/sumup?range=7d|30d|90d|365d|all|since_export
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const range = req.nextUrl.searchParams.get("range") ?? "90d";
  let from: Date | null = null;
  if (range === "since_export") {
    const last = await prisma.pppInvoice.findFirst({
      where: { exportedAt: { not: null } },
      orderBy: { exportedAt: "desc" },
      select: { exportedAt: true },
    });
    from = last?.exportedAt ?? null;
  } else if (range !== "all") {
    const days = parseInt(range.replace("d", ""), 10) || 90;
    from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  const fromISO = (from ?? new Date("2000-01-01T00:00:00Z")).toISOString();
  const revenueCents = await fetchSumupRevenueTotal(fromISO, new Date().toISOString());
  if (revenueCents == null) return NextResponse.json({ available: false });
  return NextResponse.json({ available: true, revenueCents });
}
