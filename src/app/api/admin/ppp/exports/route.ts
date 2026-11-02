import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";

// GET — the sheet exports (Dimensie) this login may see, newest first, with how
// many of their rows lack an IBAN (members without bank details in Congressus).
export async function GET() {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const batches = await prisma.pppExportBatch.findMany({
    where: ctx.scope ? { associationId: ctx.scope } : {},
    orderBy: { createdAt: "desc" },
    take: 24,
    select: { id: true, number: true, associationId: true, period: true, members: true, totalCents: true, createdAt: true },
  });
  const perBatch = await prisma.pppInvoice.findMany({
    where: { exportBatchId: { in: batches.map((b) => b.id) }, totalCents: { gt: 0 }, member: { ibanEnc: null } },
    select: { exportBatchId: true, memberId: true },
    distinct: ["exportBatchId", "memberId"],
  });
  const withoutIban = new Map<string, number>();
  for (const o of perBatch) withoutIban.set(o.exportBatchId!, (withoutIban.get(o.exportBatchId!) ?? 0) + 1);

  return NextResponse.json({ exports: batches.map((b) => ({ ...b, withoutIban: withoutIban.get(b.id) ?? 0 })) });
}
