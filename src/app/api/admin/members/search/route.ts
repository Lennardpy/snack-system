import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { memberWhere } from "@/lib/scope";
import { cardsByPerson } from "@/lib/memberships";

// Lightweight member typeahead for linking a bartender to a member.
// GET /api/admin/members/search?q=...
export async function GET(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ members: [] });

  // Every word must match somewhere, so "Test Member" matches firstName + lastName.
  const tokens = q.split(/\s+/).filter(Boolean);
  const rows = await prisma.member.findMany({
    where: {
      deletedAt: null,
      ...memberWhere(ctx.scope),
      AND: tokens.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: "insensitive" as const } },
          { lastName: { contains: t, mode: "insensitive" as const } },
          { email: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    },
    select: { id: true, firstName: true, lastName: true, email: true, associationId: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 15,
  });

  // One row per person: someone in both associations (same email) has two member
  // rows; linking resolves to the bartender's own association's one. Cards belong
  // to the person, whichever membership they sit on.
  const cards = await cardsByPerson();
  const byPerson = new Map<string, { id: string; firstName: string; lastName: string; email: string; associationIds: string[]; cardCount: number }>();
  for (const m of rows) {
    const key = m.email.toLowerCase();
    const person = byPerson.get(key);
    if (person) person.associationIds.push(m.associationId);
    else
      byPerson.set(key, {
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        associationIds: [m.associationId],
        cardCount: cards.get(key)?.length ?? 0,
      });
  }
  const members = [...byPerson.values()];
  return NextResponse.json({ members });
}
