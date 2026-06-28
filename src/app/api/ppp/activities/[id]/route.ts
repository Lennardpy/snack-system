import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";

// Activity for the POS: status, the discounts toggle, and the per-drink specials.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
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
      discountsActive: activity.discountsActive,
      discounts: activity.discounts, // [{ productId, priceCents }]
    },
  });
}

// Soft-close / reopen / rename / toggle specials. Body: { status?, name?, discountsActive? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { status, name, discountsActive } = await req.json();

  const data: { status?: "OPEN" | "CLOSED"; name?: string; discountsActive?: boolean } = {};

  if (status !== undefined) {
    if (status !== "OPEN" && status !== "CLOSED") {
      return NextResponse.json({ error: "status must be OPEN or CLOSED" }, { status: 400 });
    }
    data.status = status;
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
