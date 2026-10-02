import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { clampPercent, clampCents } from "@/lib/roles";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = await prisma.memberRole.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { members: true } } },
  });
  return NextResponse.json({ roles });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, discountPercent, discountCents, ownDrinkOnly, color } = await req.json();
  const trimmed = (name ?? "").trim();
  if (!trimmed) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const existing = await prisma.memberRole.findUnique({ where: { name: trimmed } });
  if (existing) {
    return NextResponse.json({ error: "A role with that name already exists" }, { status: 409 });
  }

  const last = await prisma.memberRole.findFirst({ orderBy: { sortOrder: "desc" } });
  const role = await prisma.memberRole.create({
    data: {
      name: trimmed,
      discountPercent: clampPercent(Number(discountPercent ?? 0)),
      discountCents: clampCents(Number(discountCents ?? 0)),
      ownDrinkOnly: ownDrinkOnly === true,
      color: typeof color === "string" && color.trim() ? color.trim() : null,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  return NextResponse.json({ role });
}
