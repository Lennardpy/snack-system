import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { congressusConfig } from "@/lib/congressus";
import { cardsByPerson } from "@/lib/memberships";
import { activityVisibleWhere, scopeAssociations } from "@/lib/scope";
import type { AssociationId } from "@/lib/associations";

// GET /api/admin/ppp/overview — the "where do we stand" block at the top of the
// PPP dashboard, one per association the login manages (the overall admin gets
// both): members and cards, upcoming borrels, what's still to bill, the last
// export, and the specifications between Stress and Dimensie.
export async function GET() {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cards = await cardsByPerson();
  const now = new Date();
  const lastRun = await prisma.monthlyExportRun.findFirst({ orderBy: { startedAt: "desc" } });
  const associations = await Promise.all(
    scopeAssociations(ctx.scope).map((association) => overview(association, cards, now, lastRun))
  );
  return NextResponse.json({ scope: ctx.scope, associations });
}

async function overview(
  association: AssociationId,
  cards: Awaited<ReturnType<typeof cardsByPerson>>,
  now: Date,
  lastRun: { period: string; finishedAt: Date | null; result: unknown } | null
) {
  const sheet = congressusConfig(association).billsFromSheet;
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const ofMembers = { member: { associationId: association } };

  const [members, withoutIban, upcoming, recentBorrels, open, needsCheck, lastBatch, lastExported, specs] =
    await Promise.all([
      prisma.member.findMany({ where: { associationId: association, active: true }, select: { email: true } }),
      sheet ? prisma.member.count({ where: { associationId: association, active: true, ibanEnc: null } }) : null,
      prisma.pppActivity.findMany({
        where: { ...activityVisibleWhere(association), date: { gte: now } },
        orderBy: { date: "asc" },
        take: 4,
        select: { id: true, name: true, date: true, joint: true, associationId: true },
      }),
      prisma.pppActivity.count({ where: { ...activityVisibleWhere(association), date: { gte: monthAgo, lt: now } } }),
      prisma.pppInvoice.groupBy({ by: ["memberId"], where: { status: "CONFIRMED", ...ofMembers }, _sum: { totalCents: true }, _count: true }),
      prisma.pppInvoice.count({ where: { status: "EXPORTING", ...ofMembers } }),
      sheet
        ? prisma.pppExportBatch.findFirst({ where: { associationId: association }, orderBy: { createdAt: "desc" } })
        : null,
      sheet
        ? null
        : prisma.pppInvoice.aggregate({ where: { status: "EXPORTED", ...ofMembers }, _max: { exportedAt: true } }),
      prisma.associationSettlement.findMany({
        where: association === "stress" ? { creditorId: "stress" } : { debtorId: association, status: "SENT" },
        orderBy: { createdAt: "desc" },
        select: { number: true, period: true, status: true, totalInclCents: true, createdAt: true, sentAt: true },
      }),
    ]);

  const toSend = specs.filter((s) => s.status === "FINAL");
  return {
    association,
    billsFromSheet: sheet,
    members: {
      active: members.length,
      withCard: members.filter((m) => cards.has(m.email.toLowerCase())).length,
      withoutIban,
    },
    borrels: {
      upcoming: upcoming.map((b) => ({ ...b, date: b.date.toISOString(), hostedByOther: b.associationId !== association })),
      lastMonth: recentBorrels,
    },
    unbilled: {
      cents: open.reduce((s, r) => s + (r._sum.totalCents ?? 0), 0),
      orders: open.reduce((s, r) => s + r._count, 0),
      members: open.length,
      needsCheck,
    },
    lastExport: lastBatch
      ? { at: lastBatch.createdAt.toISOString(), label: `${lastBatch.number} · ${lastBatch.period}` }
      : lastExported?._max.exportedAt
        ? { at: lastExported._max.exportedAt.toISOString(), label: "Congressus" }
        : null,
    // The last automatic month-end export (src/lib/monthly-export.ts) for this association.
    monthly: lastRun && {
      period: lastRun.period,
      finishedAt: lastRun.finishedAt?.toISOString() ?? null,
      ok: Array.isArray(lastRun.result)
        ? (lastRun.result as { association: string; ok: boolean }[]).find((r) => r.association === association)?.ok ?? null
        : null,
    },
    // Stress: specifications still to send to Dimensie. Dimensie: the ones received.
    specifications:
      association === "stress"
        ? { toSend: toSend.length, toSendCents: toSend.reduce((s, x) => s + x.totalInclCents, 0), latest: specs[0] ?? null }
        : { received: specs.length, latest: specs[0] ?? null },
  };
}
