import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { activityInScope } from "@/lib/scope-db";
import { CRASH_MS, getWallstreet, isVolatility } from "@/lib/wallstreet";

// Wall Street settings for an activity.
// GET → settings + the drinks to choose from + the live state when running.
// PATCH { active?, volatility?, minPct?, maxPct?, productIds?, crash? }
//   • active true (from off) starts a fresh market: tick 0 = normal prices.
//   • crash true → every drink at the floor for CRASH_MS, effective immediately.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await activityInScope(id, ctx.scope))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  const host = await prisma.pppActivity.findUniqueOrThrow({ where: { id }, select: { associationId: true } });
  const [activity, products] = await Promise.all([
    prisma.pppActivity.findUnique({
      where: { id },
      select: {
        wallstreetActive: true,
        wallstreetVolatility: true,
        wallstreetMinPct: true,
        wallstreetMaxPct: true,
        wallstreetProductIds: true,
        wallstreetStartedAt: true,
      },
    }),
    // The host's drink list.
    prisma.pppProduct.findMany({
      where: { archived: false, published: true, associationId: host.associationId },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, price: true, specialPrice: true, category: { select: { name: true } } },
    }),
  ]);
  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  return NextResponse.json({ settings: activity, products, live: await getWallstreet(id) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await activityInScope(id, ctx.scope))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  const activity = await prisma.pppActivity.findUnique({
    where: { id },
    select: { status: true, wallstreetActive: true, wallstreetMinPct: true, wallstreetMaxPct: true, wallstreetProductIds: true },
  });
  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: {
    wallstreetActive?: boolean;
    wallstreetStartedAt?: Date | null;
    wallstreetVolatility?: string;
    wallstreetMinPct?: number;
    wallstreetMaxPct?: number;
    wallstreetProductIds?: string[];
    wallstreetCrashUntil?: Date | null;
  } = {};

  if (body.volatility !== undefined) {
    if (!isVolatility(body.volatility)) return NextResponse.json({ error: "Invalid volatility" }, { status: 400 });
    data.wallstreetVolatility = body.volatility;
  }
  const minPct = body.minPct !== undefined ? Number(body.minPct) : activity.wallstreetMinPct;
  const maxPct = body.maxPct !== undefined ? Number(body.maxPct) : activity.wallstreetMaxPct;
  if (!Number.isInteger(minPct) || !Number.isInteger(maxPct) || minPct < 10 || minPct > 100 || maxPct < 100 || maxPct > 500) {
    return NextResponse.json({ error: "Floor must be 10–100% and ceiling 100–500%" }, { status: 400 });
  }
  data.wallstreetMinPct = minPct;
  data.wallstreetMaxPct = maxPct;

  if (body.productIds !== undefined) {
    if (!Array.isArray(body.productIds) || body.productIds.some((x: unknown) => typeof x !== "string")) {
      return NextResponse.json({ error: "Invalid drinks" }, { status: 400 });
    }
    const host = await prisma.pppActivity.findUniqueOrThrow({ where: { id }, select: { associationId: true } });
    const valid = await prisma.pppProduct.findMany({
      where: { id: { in: body.productIds }, archived: false, associationId: host.associationId },
      select: { id: true },
    });
    data.wallstreetProductIds = valid.map((p) => p.id);
  }
  const productIds = data.wallstreetProductIds ?? activity.wallstreetProductIds;

  if (body.active === true && !activity.wallstreetActive) {
    if (activity.status !== "OPEN") return NextResponse.json({ error: "The activity is closed" }, { status: 409 });
    if (productIds.length < 2) return NextResponse.json({ error: "Select at least 2 drinks" }, { status: 400 });
    data.wallstreetActive = true;
    data.wallstreetStartedAt = new Date();
    data.wallstreetCrashUntil = null;
  } else if (body.active === false) {
    data.wallstreetActive = false;
    data.wallstreetCrashUntil = null;
  }

  const startingFresh = data.wallstreetStartedAt !== undefined;
  const crash = body.crash === true && (activity.wallstreetActive || startingFresh);
  if (crash) data.wallstreetCrashUntil = new Date(Date.now() + CRASH_MS);

  await prisma.$transaction(async (tx) => {
    if (startingFresh) await tx.pppWallstreetTick.deleteMany({ where: { activityId: id } });
    await tx.pppActivity.update({ where: { id }, data });
    if (crash) {
      // Recompute the current tick right away (at the floor) instead of waiting
      // for the next one: drop the latest tick; the next read recomputes it.
      const latest = await tx.pppWallstreetTick.findFirst({ where: { activityId: id }, orderBy: { index: "desc" } });
      if (latest && latest.index > 0) await tx.pppWallstreetTick.delete({ where: { id: latest.id } });
    }
  });

  return NextResponse.json({ ok: true, live: await getWallstreet(id) });
}
