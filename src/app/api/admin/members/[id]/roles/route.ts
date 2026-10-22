import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// PATCH /api/admin/members/[id]/roles — set the member's full role list.
// Body: { roleIds: string[] }  (replaces existing assignments)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { roleIds } = await req.json();
  if (!Array.isArray(roleIds) || roleIds.some((r) => typeof r !== "string")) {
    return NextResponse.json({ error: "roleIds must be an array of ids" }, { status: 400 });
  }

  // A member can only hold roles of their own association.
  const target = await prisma.member.findUnique({ where: { id }, select: { associationId: true } });
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  const foreign = await prisma.memberRole.count({
    where: { id: { in: roleIds }, associationId: { not: target.associationId } },
  });
  if (foreign > 0) {
    return NextResponse.json({ error: "A role belongs to another association" }, { status: 400 });
  }

  try {
    const member = await prisma.member.update({
      where: { id },
      data: { roles: { set: roleIds.map((roleId: string) => ({ id: roleId })) } },
      include: { roles: { select: { id: true, name: true, discountPercent: true, discountCents: true, ownDrinkOnly: true, color: true } } },
    });
    return NextResponse.json({ roles: member.roles });
  } catch {
    return NextResponse.json({ error: "Member or role not found" }, { status: 404 });
  }
}
