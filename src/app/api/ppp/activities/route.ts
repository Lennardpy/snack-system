import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";

// List activities for the bartender selector. OPEN first, and since auto-imported
// Alexia borrels are all upcoming, OPEN ones are sorted SOONEST first (so today's
// borrel sits at the top); CLOSED ones most-recent first.
export async function GET() {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activities = await prisma.pppActivity.findMany({
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

  const activity = await prisma.pppActivity.create({ data: { name: trimmed } });
  return NextResponse.json({ activity });
}
