import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";
import { fetchStressEvents, alexiaMatchKey } from "@/lib/alexia";

// Import every upcoming Stress borrel from Alexia into PPP activities. Runs when a
// bartender (or admin) lands, so new borrels appear automatically and the admin
// can pre-set specials on the future ones. Idempotent + fail-soft.
export async function POST() {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const events = await fetchStressEvents();
  if (events.length === 0) return NextResponse.json({ imported: 0 });

  // Existing activities, keyed by name + calendar day (Alexia events have no id).
  const activities = await prisma.pppActivity.findMany({ select: { name: true, date: true } });
  const known = new Set(activities.map((a) => alexiaMatchKey(a.name, a.date.toISOString())));

  const toCreate = events.filter((e) => !known.has(alexiaMatchKey(e.name, e.startsAt)));
  if (toCreate.length > 0) {
    await prisma.pppActivity.createMany({
      data: toCreate.map((e) => ({ name: e.name, date: new Date(e.startsAt) })),
    });
  }

  return NextResponse.json({ imported: toCreate.length });
}
