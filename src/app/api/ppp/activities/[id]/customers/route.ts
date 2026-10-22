import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";
import { activityInScope } from "@/lib/scope-db";
import { posScope } from "@/lib/scope";

// Members who have ordered at this activity, most orders first — so the POS can
// show quick "charge again" buttons (no card scan needed for regulars).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Staff tied to an association only work at its borrels.
  if (!(await activityInScope(id, posScope(user)))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  const invoices = await prisma.pppInvoice.findMany({
    where: { activityId: id },
    select: {
      memberId: true,
      member: {
        select: {
          firstName: true,
          lastName: true,
          active: true,
          roles: { select: { name: true, discountPercent: true, discountCents: true, ownDrinkOnly: true, color: true } },
        },
      },
    },
  });

  const map = new Map<
    string,
    { memberId: string; firstName: string; lastName: string; active: boolean; roles: { name: string; discountPercent: number; discountCents: number; color: string | null }[]; orderCount: number }
  >();
  for (const inv of invoices) {
    const e = map.get(inv.memberId) ?? {
      memberId: inv.memberId,
      firstName: inv.member.firstName,
      lastName: inv.member.lastName,
      active: inv.member.active,
      roles: inv.member.roles,
      orderCount: 0,
    };
    e.orderCount += 1;
    map.set(inv.memberId, e);
  }

  const customers = [...map.values()]
    .filter((c) => c.active)
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 40);

  return NextResponse.json({ customers });
}
