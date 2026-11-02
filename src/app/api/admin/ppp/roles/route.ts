import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { clampPercent, clampCents } from "@/lib/roles";
import { roleWhere } from "@/lib/scope";
import { isAssociationId } from "@/lib/associations";

export async function GET() {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = await prisma.memberRole.findMany({
    where: roleWhere(ctx.scope),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { members: true } } },
  });
  return NextResponse.json({ roles });
}

export async function POST(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, discountPercent, discountCents, ownDrinkOnly, color, association } = await req.json();
  // A role belongs to the login's association; the overall admin picks one.
  const associationId = ctx.scope ?? (isAssociationId(association) ? association : "stress");
  const trimmed = (name ?? "").trim();
  if (!trimmed) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const existing = await prisma.memberRole.findUnique({
    where: { associationId_name: { associationId, name: trimmed } },
  });
  if (existing) {
    return NextResponse.json({ error: "A role with that name already exists" }, { status: 409 });
  }

  const last = await prisma.memberRole.findFirst({ orderBy: { sortOrder: "desc" } });
  const role = await prisma.memberRole.create({
    data: {
      associationId,
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
