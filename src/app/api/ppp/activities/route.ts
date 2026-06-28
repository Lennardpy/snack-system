import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";

// List activities, OPEN ones first, newest first within each group.
export async function GET() {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activities = await prisma.pppActivity.findMany({
    orderBy: { date: "desc" },
    include: { _count: { select: { invoices: true } } },
  });

  // OPEN before CLOSED, preserving the date ordering within each group.
  activities.sort((a, b) => Number(a.status === "CLOSED") - Number(b.status === "CLOSED"));

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
