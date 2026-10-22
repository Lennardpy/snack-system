import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMemberAdmin } from "@/lib/auth";
import { memberWhere, scopeAssociations } from "@/lib/scope";

export async function GET() {
  // SSS admin: Stress members. PPP admin: the members of its association (all for the overall admin).
  const ctx = await requireMemberAdmin();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const members = await prisma.member.findMany({
    where: { deletedAt: null, ...memberWhere(ctx.scope) }, // deleted (anonymised) members are hidden
    include: {
      cards: true,
      roles: { select: { id: true, name: true, discountPercent: true, discountCents: true, ownDrinkOnly: true, color: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return NextResponse.json({ members, associations: scopeAssociations(ctx.scope) });
}
