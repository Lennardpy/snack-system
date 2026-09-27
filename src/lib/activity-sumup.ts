import { prisma } from "./prisma";
import { fetchSumupBreakdown, type SumupDrink } from "./sumup";

// SumUp card revenue per borrel, cached. Card sales for a past borrel don't change,
// so once the borrel's day is over the breakdown is fetched once and stored in
// PppActivitySumup; while it's today/ongoing it's fetched live (not stored).

export interface ActivitySumup {
  revenueCents: number;
  count: number;
  byDrink: SumupDrink[];
  from: string;
  to: string;
  // "saved" = served from the stored snapshot; "live" = fetched just now.
  source: "saved" | "live";
  fetchedAt: string;
}

type ActivityWindowInput = { date: Date; startsAt: Date | null; endsAt: Date | null };

// The SumUp time window for a borrel: its startsAt/endsAt (from Alexia) or, failing
// that, the whole `date` calendar day.
export function activityWindow(a: ActivityWindowInput): { from: Date; to: Date } {
  if (a.startsAt && a.endsAt) return { from: a.startsAt, to: a.endsAt };
  const from = new Date(a.date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

// A borrel is final (safe to store) from the day after it: once both its end and
// the midnight after its start have passed (plus an hour's margin), so a borrel
// running past midnight is saved after it actually ends.
export function isFinal(a: ActivityWindowInput, now = new Date()): boolean {
  const { from, to } = activityWindow(a);
  const nextMidnight = new Date(from);
  nextMidnight.setHours(0, 0, 0, 0);
  nextMidnight.setDate(nextMidnight.getDate() + 1);
  const finalAt = Math.max(to.getTime(), nextMidnight.getTime()) + 60 * 60_000;
  return now.getTime() >= finalAt;
}

// Card revenue for one borrel: the stored snapshot when there is one, else a live
// SumUp fetch — stored when the borrel is final. `refresh` re-fetches and overwrites.
// Returns null when SumUp is unavailable and nothing is stored.
export async function getActivitySumup(
  activityId: string,
  opts: { refresh?: boolean } = {}
): Promise<ActivitySumup | null> {
  const a = await prisma.pppActivity.findUnique({
    where: { id: activityId },
    select: { date: true, startsAt: true, endsAt: true, sumup: true },
  });
  if (!a) return null;
  const { from, to } = activityWindow(a);

  if (a.sumup && !opts.refresh) {
    return {
      revenueCents: a.sumup.revenueCents,
      count: a.sumup.count,
      byDrink: a.sumup.byDrink as unknown as SumupDrink[],
      from: from.toISOString(),
      to: to.toISOString(),
      source: "saved",
      fetchedAt: a.sumup.fetchedAt.toISOString(),
    };
  }

  const live = await fetchSumupBreakdown(from.toISOString(), to.toISOString());
  if (!live) return null;

  const now = new Date();
  if (isFinal(a, now)) {
    const data = {
      revenueCents: live.revenueCents,
      count: live.count,
      byDrink: live.byDrink as unknown as object,
      fetchedAt: now,
    };
    await prisma.pppActivitySumup.upsert({
      where: { activityId },
      create: { activityId, ...data },
      update: data,
    });
  }

  return {
    ...live,
    from: from.toISOString(),
    to: to.toISOString(),
    source: "live",
    fetchedAt: now.toISOString(),
  };
}
