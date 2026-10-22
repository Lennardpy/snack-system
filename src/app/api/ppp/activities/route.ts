import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";
import { activityWhere, posScope } from "@/lib/scope";

// List activities for the bartender selector. OPEN first, and since auto-imported
// Alexia borrels are all upcoming, OPEN ones are sorted SOONEST first (so today's
// borrel sits at the top); CLOSED ones most-recent first.
//
// The selector shows only TODAY's borrels — plus any still-OPEN borrel that
// started before today, so a borrel running past midnight stays accessible while
// it's open. Everything else (future/old borrels) is hidden from bartenders;
// admins still see every activity on the admin Activities page.
export async function GET() {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const carryoverFloor = new Date(startOfToday);
  carryoverFloor.setDate(carryoverFloor.getDate() - 1); // yesterday 00:00

  const activities = await prisma.pppActivity.findMany({
    where: {
      ...activityWhere(posScope(user)),
      OR: [
        // Today's borrels (any status).
        { date: { gte: startOfToday, lt: startOfTomorrow } },
        // A borrel that started before today but is still open (ran past midnight).
        { status: "OPEN", date: { gte: carryoverFloor, lt: startOfToday } },
      ],
    },
    include: { _count: { select: { invoices: true } } },
  });

  activities.sort((a, b) => {
    if (a.status !== b.status) return a.status === "OPEN" ? -1 : 1;
    const da = a.date.getTime();
    const db = b.date.getTime();
    return a.status === "OPEN" ? da - db : db - da; // OPEN asc, CLOSED desc
  });

  return NextResponse.json({ activities });
}

// Create an activity. Body: { name }
export async function POST(req: NextRequest) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await req.json();
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Hosted by the bartender's association (Stress for unscoped admins).
  const activity = await prisma.pppActivity.create({
    data: { name: trimmed, associationId: posScope(user) ?? "stress" },
  });
  return NextResponse.json({ activity });
}
