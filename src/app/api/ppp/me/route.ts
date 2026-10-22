import { NextResponse } from "next/server";
import { requireBartender, isOverallAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { membershipsOf } from "@/lib/memberships";

// The logged-in PPP user: their own linked member (the POS uses it to give the
// on-shift bartender their free drinks when they charge their own card) and the
// association they work for (null = every association, the overall admin), which
// the PPP admin pages use to show the right options.
export async function GET() {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Every membership of the bartender's person (Stress + Dimensie), so their free
  // drinks also apply when a joint borrel charges their Stress membership.
  const own = user.memberId ? await prisma.member.findUnique({ where: { id: user.memberId }, select: { id: true, email: true } }) : null;
  const memberIds = own ? (await membershipsOf(own)).map((m) => m.id) : [];
  return NextResponse.json({
    memberId: user.memberId ?? null,
    memberIds,
    role: user.role,
    associationId: user.associationId ?? null,
    overall: isOverallAdmin(user),
  });
}
