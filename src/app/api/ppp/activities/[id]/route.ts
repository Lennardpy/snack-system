import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";
import { activityInScope, activityVisible } from "@/lib/scope-db";
import { posScope } from "@/lib/scope";

// How long after its date a bartender may still reopen a closed borrel.
const REOPEN_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

// Activity for the POS: status, the discounts toggle, and the per-drink specials.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Staff tied to an association only work at its borrels.
  if (!(await activityVisible(id, posScope(user)))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  const activity = await prisma.pppActivity.findUnique({
    where: { id },
    include: { discounts: { select: { productId: true, priceCents: true } } },
  });
  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  return NextResponse.json({
    activity: {
      id: activity.id,
      name: activity.name,
      status: activity.status,
      associationId: activity.associationId,
      joint: activity.joint,
      discountsActive: activity.discountsActive,
      discounts: activity.discounts, // [{ productId, priceCents }]
    },
  });
}

// Soft-close / reopen / rename / toggle specials. Body: { status?, name?, discountsActive? }
// Only by staff of the hosting association (not Dimensie at a joint borrel).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Staff tied to an association only work at its borrels.
  if (!(await activityInScope(id, posScope(user)))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  const { status, name, discountsActive } = await req.json();

  const data: { status?: "OPEN" | "CLOSED"; name?: string; discountsActive?: boolean } = {};

  if (status !== undefined) {
    if (status !== "OPEN" && status !== "CLOSED") {
      return NextResponse.json({ error: "status must be OPEN or CLOSED" }, { status: 400 });
    }
    data.status = status;
    // Reopening an old borrel (likely billed already) is for admins only, so
    // bartenders can't add charges to it after the fact.
    if (status === "OPEN" && user.role !== "ADMIN") {
      const current = await prisma.pppActivity.findUnique({ where: { id }, select: { status: true, date: true } });
      if (current?.status === "CLOSED" && Date.now() - current.date.getTime() > REOPEN_WINDOW_MS) {
        return NextResponse.json({ error: "Only an admin can reopen a borrel older than 2 days" }, { status: 403 });
      }
    }
  }

  if (name !== undefined) {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    data.name = trimmed;
  }

  if (discountsActive !== undefined) data.discountsActive = Boolean(discountsActive);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const activity = await prisma.pppActivity.update({ where: { id }, data });
    return NextResponse.json({ activity });
  } catch {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
}
