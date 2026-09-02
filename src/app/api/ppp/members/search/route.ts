import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";

// Member typeahead for the bar POS — used when a bartender links an unrecognised
// card to a member. Same tokenised search as the admin one, but behind
// requireBartender() so it's available on the POS.
// GET /api/ppp/members/search?q=...
export async function GET(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ members: [] });

  // Every word must match somewhere, so "Test Member" matches firstName + lastName.
  const tokens = q.split(/\s+/).filter(Boolean);
  const rows = await prisma.member.findMany({
    where: {
      active: true,
      AND: tokens.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: "insensitive" as const } },
          { lastName: { contains: t, mode: "insensitive" as const } },
          { email: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    },
    select: { id: true, firstName: true, lastName: true, email: true, cards: { select: { id: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 15,
  });

  const members = rows.map((m) => ({
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    email: m.email,
    cardCount: m.cards.length,
  }));
  return NextResponse.json({ members });
}
