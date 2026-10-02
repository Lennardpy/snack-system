import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { dayStartUTC, loadSbzLists, sbzListAt } from "@/lib/sbz-db";
import type { SbzProduct } from "@/lib/sbz";

// SBZ price lists (versioned cost prices). GET returns every version, newest
// first, with the id of the one valid today. POST saves a version: a new list
// valid from `validFrom`, or — when a list already starts that day — replaces it.
// Borrels before `validFrom` keep using the earlier list, so their cost of goods
// never changes.

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const lists = await loadSbzLists();
  const current = sbzListAt(lists, new Date());
  return NextResponse.json({
    currentId: current?.id ?? null,
    lists: lists.map((l) => ({ ...l, validFrom: l.validFrom.toISOString() })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const validFrom = dayStartUTC(String(body?.validFrom ?? ""));
  if (!validFrom) return NextResponse.json({ error: "Pick the date these prices apply from" }, { status: 400 });
  const label = String(body?.label ?? "").trim() || `SBZ price list ${body.validFrom}`;
  const source = typeof body?.source === "string" ? body.source.slice(0, 200) : null;

  const raw: unknown[] = Array.isArray(body?.items) ? body.items : [];
  const items: SbzProduct[] = [];
  const keys = new Set<string>();
  for (const r of raw) {
    const it = r as Partial<SbzProduct>;
    const key = String(it.key ?? "");
    const name = String(it.name ?? "").trim();
    const excl = Number(it.costExclCents);
    const incl = Number(it.costInclCents);
    const vat = Number(it.vatRate);
    if (!/^[a-z0-9-]{1,60}$/.test(key) || keys.has(key)) {
      return NextResponse.json({ error: `Invalid or duplicate item key "${key}"` }, { status: 400 });
    }
    if (!name) return NextResponse.json({ error: "Every item needs a name" }, { status: 400 });
    if (it.unit !== "LITER" && it.unit !== "UNIT") {
      return NextResponse.json({ error: `"${name}": unit must be liter (keg) or unit` }, { status: 400 });
    }
    if (![excl, incl].every((n) => Number.isInteger(n) && n >= 0) || !(vat >= 0 && vat <= 100)) {
      return NextResponse.json({ error: `"${name}": invalid price or VAT` }, { status: 400 });
    }
    keys.add(key);
    items.push({
      key,
      name,
      section: String(it.section ?? "Other").trim() || "Other",
      unit: it.unit,
      vatRate: Math.round(vat),
      costExclCents: excl,
      costInclCents: incl,
      onRequest: it.onRequest === true,
    });
  }
  if (items.length === 0) return NextResponse.json({ error: "The price list has no items" }, { status: 400 });

  const list = await prisma.$transaction(async (tx) => {
    const existing = await tx.sbzPriceList.findUnique({ where: { validFrom } });
    const saved = existing
      ? await tx.sbzPriceList.update({ where: { id: existing.id }, data: { label, source } })
      : await tx.sbzPriceList.create({ data: { label, source, validFrom } });
    if (existing) await tx.sbzPrice.deleteMany({ where: { listId: saved.id } });
    await tx.sbzPrice.createMany({
      data: items.map((it, i) => ({ ...it, onRequest: it.onRequest ?? false, sortOrder: i, listId: saved.id })),
    });
    return { id: saved.id, replaced: !!existing };
  });

  return NextResponse.json({ ok: true, ...list });
}
