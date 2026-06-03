import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchAllMembers } from "@/lib/congressus";
import { requireAdmin } from "@/lib/auth";

export async function POST() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const members = await fetchAllMembers();

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

  return NextResponse.json({ ok: true, created, updated, skipped, total: members.length });
}
