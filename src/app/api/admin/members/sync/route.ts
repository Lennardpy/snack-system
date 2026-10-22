import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchAllMembers } from "@/lib/congressus";
import { requireAdmin } from "@/lib/auth";

export async function POST() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Throws if any Congressus page fails, so a partial list never reaches the prune.
  let members: Awaited<ReturnType<typeof fetchAllMembers>>;
  try {
    members = await fetchAllMembers();
  } catch (err) {
    console.error("Member sync: Congressus fetch failed", err);
    return NextResponse.json({ error: "Could not fetch members from Congressus — nothing was changed." }, { status: 502 });
  }

  // ── Remove members that are no longer in Congressus ─────────────────────────
  // (removed there, or no longer an allowed member status). Otherwise they could
  // keep buying with no way to invoice them. Done before the upsert so a stale
  // record doesn't block a new member re-using its email.
  const prune = await pruneMissingMembers(new Set(members.map((m) => m.id)));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const m of members) {
    // Skip members with no email — can't uniquely identify them
    if (!m.email) { skipped++; continue; }

    const active =
      !m.deleted &&
      !m.locked &&
      !m.status?.archived &&
      !m.status?.deceased;

    try {
      const existing = await prisma.member.findUnique({ where: { congressusId: m.id } });

      if (existing) {
        await prisma.member.update({
          where: { congressusId: m.id },
          data: {
            firstName: m.first_name,
            lastName: m.last_name,
            email: m.email,
            active,
          },
        });
        updated++;
      } else {
        // Check if email already taken by another member (data quality issue in Congressus)
        const emailTaken = await prisma.member.findUnique({ where: { email: m.email } });
        if (emailTaken) { skipped++; continue; }

        await prisma.member.create({
          data: {
            congressusId: m.id,
            firstName: m.first_name,
            lastName: m.last_name,
            email: m.email,
            active,
          },
        });
        created++;
      }
    } catch (err) {
      console.error(`Failed to sync member ${m.id}:`, err);
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, created, updated, skipped, total: members.length, ...prune });
}

// Members in our DB but not in the Congressus list: deleted when they have no
// history, otherwise deactivated (purchases blocked, history + open invoice kept).
// Skipped when the list looks implausibly small, so an API hiccup can't wipe everyone.
async function pruneMissingMembers(congressusIds: Set<number>) {
  const activeCount = await prisma.member.count({ where: { active: true } });
  if (congressusIds.size === 0 || congressusIds.size < activeCount / 2) {
    return {
      deleted: 0,
      deactivated: 0,
      openInvoices: [] as { name: string; openCents: number }[],
      pruneSkipped: `Congressus returned ${congressusIds.size} members vs ${activeCount} active here — clean-up skipped as a safety measure.`,
    };
  }

  const missing = await prisma.member.findMany({
    where: { congressusId: { notIn: [...congressusIds] }, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      active: true,
      user: { select: { id: true } },
      _count: { select: { invoices: true, pppInvoices: true } },
    },
  });

  let deleted = 0;
  let deactivated = 0;
  const toDeactivate: string[] = [];
  for (const m of missing) {
    if (m._count.invoices === 0 && m._count.pppInvoices === 0 && !m.user) {
      await prisma.$transaction([
        prisma.card.deleteMany({ where: { memberId: m.id } }),
        prisma.shopSession.deleteMany({ where: { memberId: m.id } }),
        prisma.member.delete({ where: { id: m.id } }),
      ]);
      deleted++;
    } else {
      toDeactivate.push(m.id);
      if (m.active) deactivated++;
    }
  }
  if (toDeactivate.length > 0) {
    await prisma.$transaction([
      prisma.member.updateMany({ where: { id: { in: toDeactivate } }, data: { active: false } }),
      // End any open kiosk shop session right away.
      prisma.shopSession.deleteMany({ where: { memberId: { in: toDeactivate } } }),
    ]);
  }

  // Deactivated members who still owe money that hasn't been exported yet.
  const [sss, ppp] = await Promise.all([
    prisma.saleInvoice.groupBy({
      by: ["memberId"],
      where: { memberId: { in: toDeactivate }, status: { in: ["CONFIRMED", "EXPORTING"] } },
      _sum: { totalCents: true },
    }),
    prisma.pppInvoice.groupBy({
      by: ["memberId"],
      where: { memberId: { in: toDeactivate }, status: { in: ["CONFIRMED", "EXPORTING"] } },
      _sum: { totalCents: true },
    }),
  ]);
  const open = new Map<string, number>();
  for (const r of [...sss, ...ppp]) open.set(r.memberId, (open.get(r.memberId) ?? 0) + (r._sum.totalCents ?? 0));
  const openInvoices = missing
    .filter((m) => (open.get(m.id) ?? 0) > 0)
    .map((m) => ({ name: `${m.firstName} ${m.lastName}`.trim(), openCents: open.get(m.id) ?? 0 }));

  return { deleted, deactivated, openInvoices, pruneSkipped: null as string | null };
}
