import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMemberAdmin } from "@/lib/auth";
import { memberWhere, scopeAssociations } from "@/lib/scope";
import { cardsByPerson } from "@/lib/memberships";

export async function GET() {
  // SSS admin: Stress members. PPP admin: the members of its association (all for the overall admin).
  const ctx = await requireMemberAdmin();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.member.findMany({
    where: { deletedAt: null, ...memberWhere(ctx.scope) }, // deleted (anonymised) members are hidden
    include: {
      roles: { select: { id: true, name: true, discountPercent: true, discountCents: true, ownDrinkOnly: true, color: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  // The person's cards, on whichever of their memberships they're stored.
  const cards = await cardsByPerson();
  const members = rows.map((m) => ({ ...m, cards: cards.get(m.email.toLowerCase()) ?? [] }));

  return NextResponse.json({ members, associations: scopeAssociations(ctx.scope) });
}
