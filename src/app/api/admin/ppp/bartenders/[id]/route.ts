import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { memberWhere, userWhere } from "@/lib/scope";
import { cardsByPerson, membershipsOf } from "@/lib/memberships";
import { ASSOCIATION_LABEL, type AssociationId } from "@/lib/associations";

// Link / unlink a bartender to a member (so they can log in by scanning a card).
// Body: { memberId: string }  to link, or { memberId: null } to unlink.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { memberId } = await req.json();

  const user = await prisma.user.findFirst({ where: { id, ...userWhere(ctx.scope) } });
  if (!user || user.role !== "BARTENDER") {
    return NextResponse.json({ error: "Bartender not found" }, { status: 404 });
  }

  if (memberId === null) {
    await prisma.user.update({ where: { id }, data: { memberId: null } });
    return NextResponse.json({ ok: true, member: null });
  }

  if (typeof memberId !== "string") {
    return NextResponse.json({ error: "memberId must be a string or null" }, { status: 400 });
  }

  const picked = await prisma.member.findFirst({
    where: { id: memberId, deletedAt: null, ...memberWhere(ctx.scope) },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (!picked) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  // A bartender is linked to the person's membership of the bartender's own
  // association — also when the admin picked the person's other membership (the
  // search shows both; cards sit on the Stress one).
  const own = user.associationId
    ? (await membershipsOf(picked)).find((m) => m.associationId === user.associationId)
    : picked;
  if (!own) {
    const assoc = ASSOCIATION_LABEL[user.associationId as AssociationId];
    return NextResponse.json(
      {
        error: `${picked.firstName} ${picked.lastName} isn't a ${assoc} member here (${picked.email}). ` +
          `Run "Sync ${assoc}" if they joined recently, or check their email in ${assoc}'s Congressus.`,
      },
      { status: 400 }
    );
  }
  const member = await prisma.member.findUniqueOrThrow({ where: { id: own.id } });
  const cardCount = (await cardsByPerson()).get(member.email.toLowerCase())?.length ?? 0;

  // User.memberId is unique — make sure this member isn't already linked elsewhere.
  const clash = await prisma.user.findUnique({ where: { memberId: member.id } });
  if (clash && clash.id !== id) {
    return NextResponse.json({ error: "That member is already linked to another account" }, { status: 409 });
  }

  await prisma.user.update({ where: { id }, data: { memberId: member.id } });
  return NextResponse.json({
    ok: true,
    member: {
      id: member.id,
      name: `${member.firstName} ${member.lastName}`.trim(),
      email: member.email,
      cardCount,
    },
  });
}

// Delete a bartender account (cascades sessions + invite token).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const user = await prisma.user.findFirst({ where: { id, ...userWhere(ctx.scope) } });
  if (!user || user.role !== "BARTENDER") {
    return NextResponse.json({ error: "Bartender not found" }, { status: 404 });
  }

  // Sessions cascade (onDelete: Cascade); the invite token cascades too.
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
