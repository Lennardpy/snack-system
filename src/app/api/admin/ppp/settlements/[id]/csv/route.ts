import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { isStressSide, inScope } from "@/lib/scope";
import { settlementCsv } from "@/lib/settlement-pdf";
import type { SettlementSnapshot } from "@/lib/settlement";

// Download a finalised invoice from Stress to Dimensie as CSV (per member per drink) — both sides.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const s = await prisma.associationSettlement.findUnique({ where: { id: (await params).id } });
  // Dimensie: only once Stress's treasurer has sent it.
  if (!s || !(isStressSide(ctx.scope) || (inScope(ctx.scope, s.debtorId) && s.status === "SENT"))) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  const snapshot = s.snapshot as unknown as SettlementSnapshot;
  return new NextResponse(settlementCsv(s.number, snapshot), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${s.number}-purchases.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
