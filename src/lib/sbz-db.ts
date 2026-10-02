import { prisma } from "./prisma";
import { sbzCatalog, type SbzCatalog, type SbzProduct, type SbzUnit } from "./sbz";

// Server-side access to the versioned SBZ price lists (see src/lib/sbz.ts).

export interface SbzList {
  id: string;
  label: string;
  validFrom: Date;
  source: string | null;
  items: SbzProduct[];
}

// All price lists, newest validFrom first, items in list order.
export async function loadSbzLists(): Promise<SbzList[]> {
  const lists = await prisma.sbzPriceList.findMany({
    orderBy: { validFrom: "desc" },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  return lists.map((l) => ({
    id: l.id,
    label: l.label,
    validFrom: l.validFrom,
    source: l.source,
    items: l.items.map((i) => ({
      key: i.key,
      name: i.name,
      section: i.section,
      unit: i.unit as SbzUnit,
      vatRate: i.vatRate,
      costExclCents: i.costExclCents,
      costInclCents: i.costInclCents,
      onRequest: i.onRequest,
    })),
  }));
}

// The list valid at `at`: the newest one whose validFrom ≤ at (falls back to the
// oldest list for dates before every list). `lists` must be newest-first.
export function sbzListAt(lists: SbzList[], at: Date): SbzList | null {
  return lists.find((l) => l.validFrom.getTime() <= at.getTime()) ?? lists[lists.length - 1] ?? null;
}

// Prices for a borrel on `at`: the list valid then, plus — for any item missing
// from it (e.g. dropped from a later list) — that item's most recent earlier price,
// so usage already entered keeps a cost.
export function sbzCatalogAt(lists: SbzList[], at: Date): SbzCatalog {
  const current = sbzListAt(lists, at);
  const catalog = sbzCatalog(current?.items ?? []);
  const idx = current ? lists.indexOf(current) : -1;
  for (const older of lists.slice(idx + 1)) {
    for (const item of older.items) if (!catalog[item.key]) catalog[item.key] = item;
  }
  return catalog;
}

// Start of a YYYY-MM-DD day in UTC — what validFrom is stored as.
export function dayStartUTC(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
