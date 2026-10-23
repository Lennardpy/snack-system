import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { isStressSide, inScope } from "@/lib/scope";

// One finalised invoice from Stress to Dimensie.
//   GET    → its frozen figures (both sides).
//   PATCH  { status: "SENT" } → mark as sent to Dimensie (Stress side).
//   DELETE → undo a not-yet-sent invoice: the orders are unlocked and go back
//            into the draft (Stress side).

async function load(id: string) {
  return prisma.associationSettlement.findUnique({ where: { id } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const s = await load((await params).id);
  // Dimensie: only once Stress's treasurer has sent it.
  if (!s || !(isStressSide(ctx.scope) || (inScope(ctx.scope, s.debtorId) && s.status === "SENT"))) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  return NextResponse.json({ settlement: s });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) return NextResponse.json({ error: "Only Stress manages these invoices" }, { status: 403 });
  const { status } = await req.json().catch(() => ({}));
  if (status !== "SENT") return NextResponse.json({ error: 'status must be "SENT"' }, { status: 400 });
  const { count } = await prisma.associationSettlement.updateMany({
    where: { id: (await params).id, status: "FINAL" },
    data: { status: "SENT", sentAt: new Date() },
  });
  if (count === 0) return NextResponse.json({ error: "Invoice not found or already sent" }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) return NextResponse.json({ error: "Only Stress manages these invoices" }, { status: 403 });
  // Orders' settlementId is set to null by the relation (onDelete: SetNull).
  const { count } = await prisma.associationSettlement.deleteMany({ where: { id: (await params).id, status: "FINAL" } });
  if (count === 0) {
    return NextResponse.json({ error: "Only a finalised invoice that hasn't been sent can be undone" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
