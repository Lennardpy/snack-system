import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// POST /api/admin/members/[id]/shop
// Admin-only: open the kiosk shop as this member (e.g. to place a manual order
// or test). Creates a short-lived shop session and returns its token.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const member = await prisma.member.findUnique({ where: { id } });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (member.associationId !== "stress") {
    return NextResponse.json({ error: "The snack kiosk is for Stress members only" }, { status: 403 });
  }

  // Replace any existing session for this member.
  await prisma.shopSession.deleteMany({ where: { memberId: id } });
  const session = await prisma.shopSession.create({
    data: {
      memberId: id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  });

  return NextResponse.json({ token: session.token });
}
