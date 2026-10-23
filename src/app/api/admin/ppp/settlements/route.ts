import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { isStressSide } from "@/lib/scope";
import { createSettlement, pendingSettlement, SettlementError, SETTLEMENT_DEBTOR } from "@/lib/settlement";

// Stress's specifications to Dimensie (src/lib/settlement.ts). They're created
// automatically by each Dimensie export.
//   GET  → the specifications, plus — for the Stress side — what's waiting for the
//          next one (billed orders not specified yet, and orders not billed yet).
//   POST → create a specification now from the billed orders (Stress side) — e.g.
//          after undoing one.
// Dimensie only sees specifications Stress has marked SENT: the treasurer books and
// sends them first (the system itself never sends anything to Dimensie).
export async function GET() {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const stressSide = isStressSide(ctx.scope);

  const settlements = await prisma.associationSettlement.findMany({
    where: { debtorId: SETTLEMENT_DEBTOR, ...(stressSide ? {} : { status: "SENT" as const }) },
    orderBy: { createdAt: "desc" },
    select: { id: true, number: true, period: true, status: true, totalInclCents: true, createdAt: true, sentAt: true, _count: { select: { orders: true } } },
  });
  const pending = stressSide ? await pendingSettlement() : null;

  return NextResponse.json({ canManage: stressSide, settlements, pending });
}

export async function POST() {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) {
    return NextResponse.json({ error: "Only Stress creates these specifications" }, { status: 403 });
  }
  try {
    const settlement = await createSettlement(ctx.user.id);
    if (!settlement) return NextResponse.json({ error: "Nothing billed by Dimensie to specify." }, { status: 409 });
    return NextResponse.json({ settlement: { id: settlement.id, number: settlement.number } });
  } catch (err) {
    if (err instanceof SettlementError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
