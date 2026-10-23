import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { isStressSide } from "@/lib/scope";
import {
  draftSettlement,
  finalizeSettlement,
  isMonth,
  previousMonth,
  SettlementError,
  SETTLEMENT_DEBTOR,
} from "@/lib/settlement";

// Stress's monthly invoices to Dimensie (src/lib/settlement.ts).
//   GET  ?month=YYYY-MM → the finalised invoices, plus — for the Stress side — the
//        live draft for that month (default: last month).
//   POST { month }      → finalise that month (Stress side): freeze + lock orders.
// Dimensie only sees invoices Stress has marked SENT: the treasurer books and sends
// them first (the system itself never sends anything to Dimensie).
export async function GET(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const stressSide = isStressSide(ctx.scope);

  const settlements = await prisma.associationSettlement.findMany({
    where: { debtorId: SETTLEMENT_DEBTOR, ...(stressSide ? {} : { status: "SENT" as const }) },
    orderBy: { month: "desc" },
    select: { id: true, number: true, month: true, status: true, totalInclCents: true, createdAt: true, sentAt: true, _count: { select: { orders: true } } },
  });

  const raw = req.nextUrl.searchParams.get("month");
  const month = isMonth(raw) ? raw : previousMonth();
  const draft = stressSide ? (await draftSettlement(month)).snapshot : null;

  return NextResponse.json({ month, canManage: stressSide, settlements, draft });
}

export async function POST(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) {
    return NextResponse.json({ error: "Only Stress issues these invoices" }, { status: 403 });
  }
  const { month } = await req.json().catch(() => ({}));
  if (!isMonth(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  try {
    const settlement = await finalizeSettlement(month, ctx.user.id);
    return NextResponse.json({ settlement: { id: settlement.id, number: settlement.number } });
  } catch (err) {
    if (err instanceof SettlementError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
