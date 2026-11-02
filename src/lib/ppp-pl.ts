import { prisma } from "./prisma";
import { activityWhere, type Scope } from "./scope";

// Dashboard range → start date. `since_export` starts at the last PPP export
// (null = no export yet → everything); `all` = no start.
export async function resolvePppRange(range: string): Promise<{
  sinceExport: boolean;
  from: Date | null;
  lastExportAt: Date | null;
}> {
  if (range === "since_export") {
    const last = await prisma.pppInvoice.findFirst({
      where: { exportedAt: { not: null } },
      orderBy: { exportedAt: "desc" },
      select: { exportedAt: true },
    });
    const lastExportAt = last?.exportedAt ?? null;
    return { sinceExport: true, from: lastExportAt, lastExportAt };
  }
  const days = range === "all" ? null : parseInt(range.replace("d", ""), 10) || 90;
  return {
    sinceExport: false,
    from: days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null,
    lastExportAt: null,
  };
}

// Borrels in the range that have cost of goods (SBZ usage) uploaded. Only these
// count towards the dashboard profit/loss — income from borrels without costs
// would make the result look better than it is.
export async function costedActivityIds(from: Date | null, scope: Scope = null): Promise<string[]> {
  const rows = await prisma.pppActivity.findMany({
    where: { usage: { some: {} }, ...(from ? { date: { gte: from } } : {}), ...activityWhere(scope) },
    select: { id: true },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => r.id);
}
