import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";
import { activityVisible } from "@/lib/scope-db";
import { posScope } from "@/lib/scope";

// Published, non-archived PPP drinks for the POS screen, grouped-ready (the
// client groups by category). Returns category for the tab bar.
// ?activityId= → the drink list of the association hosting that borrel (Stress's
// at a joint borrel, also for Dimensie bartenders).
export async function GET(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activityId = req.nextUrl.searchParams.get("activityId") ?? "";
  const activity = await prisma.pppActivity.findUnique({ where: { id: activityId }, select: { associationId: true } });
  if (!activity || !(await activityVisible(activityId, posScope(user)))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const products = await prisma.pppProduct.findMany({
    where: { published: true, archived: false, associationId: activity.associationId },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      price: true,
      specialPrice: true,
      imageUrl: true,
      color: true,
      categoryId: true,
      category: { select: { id: true, name: true, sortOrder: true, bartenderFree: true } },
    },
  });

  return NextResponse.json({ products });
}
