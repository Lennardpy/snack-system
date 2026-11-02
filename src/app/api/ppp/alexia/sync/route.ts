import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";
import { fetchAlexiaEvents, alexiaMatchKey, isJointBorrel } from "@/lib/alexia";

// Import every upcoming Stress and Dimensie borrel from Alexia into PPP
// activities, hosted by the organiser (Stress's Thursday weekly drink is joint). Runs when a
// bartender (or admin) lands, so new borrels appear automatically and the admin
// can pre-set specials on the future ones. Idempotent + fail-soft.
export async function POST() {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const events = await fetchAlexiaEvents();
  if (events.length === 0) return NextResponse.json({ imported: 0 });

  // Existing activities, keyed by name + calendar day (Alexia events have no id),
  // plus events the admin deleted (external activities / free drinks) — never re-import.
  const [activities, dismissed] = await Promise.all([
    prisma.pppActivity.findMany({ select: { name: true, date: true } }),
    prisma.pppDismissedEvent.findMany({ select: { matchKey: true } }),
  ]);
  const known = new Set([
    ...activities.map((a) => alexiaMatchKey(a.name, a.date.toISOString())),
    ...dismissed.map((d) => d.matchKey),
  ]);

  const toCreate = events.filter((e) => !known.has(alexiaMatchKey(e.name, e.startsAt)));
  if (toCreate.length > 0) {
    await prisma.pppActivity.createMany({
      data: toCreate.map((e) => ({
        associationId: e.associationId,
        joint: isJointBorrel(e.associationId, e.name, new Date(e.startsAt)),
        name: e.name,
        date: new Date(e.startsAt),
        startsAt: new Date(e.startsAt),
        endsAt: new Date(e.endsAt),
      })),
    });
  }

  return NextResponse.json({ imported: toCreate.length });
}
