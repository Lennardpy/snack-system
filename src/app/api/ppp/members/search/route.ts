import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";
import { payingAssociations } from "@/lib/memberships";
import { activityVisible } from "@/lib/scope-db";
import { posScope } from "@/lib/scope";
import type { AssociationId } from "@/lib/associations";

// Member typeahead for the bar POS — used when a bartender links an unrecognised
// card to a member. Only members who may pay at this borrel (both associations at
// a joint borrel), and ONE row per person: someone in both associations (same
// email) shows once, with both associations, as the membership that pays here.
// GET /api/ppp/members/search?q=...&activityId=...
export async function GET(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const activityId = req.nextUrl.searchParams.get("activityId") ?? "";
  if (q.length < 2) return NextResponse.json({ members: [] });
  const activity = await prisma.pppActivity.findUnique({ where: { id: activityId }, select: { associationId: true, joint: true } });
  if (!activity || !(await activityVisible(activityId, posScope(user)))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  const paying = payingAssociations(activity);

  // Every word must match somewhere, so "Test Member" matches firstName + lastName.
  const tokens = q.split(/\s+/).filter(Boolean);
  const rows = await prisma.member.findMany({
    where: {
      active: true,
      deletedAt: null,
      associationId: { in: paying },
      AND: tokens.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: "insensitive" as const } },
          { lastName: { contains: t, mode: "insensitive" as const } },
          { email: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    },
    select: { id: true, associationId: true, firstName: true, lastName: true, email: true, cards: { select: { id: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 40,
  });

  // One entry per person, as their most preferred paying membership.
  const people = new Map<string, { row: (typeof rows)[number]; associations: AssociationId[]; cardCount: number }>();
  for (const m of rows) {
    const key = m.email.toLowerCase();
    const p = people.get(key);
    const association = m.associationId as AssociationId;
    if (!p) {
      people.set(key, { row: m, associations: [association], cardCount: m.cards.length });
      continue;
    }
    p.associations.push(association);
    p.cardCount += m.cards.length;
    if (paying.indexOf(association) < paying.indexOf(p.row.associationId as AssociationId)) p.row = m;
  }

  const members = [...people.values()].slice(0, 15).map(({ row, associations, cardCount }) => ({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    associations: paying.filter((a) => associations.includes(a)),
    cardCount,
  }));
  return NextResponse.json({ members });
}
