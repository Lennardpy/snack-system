import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMemberAdmin } from "@/lib/auth";
import { inScope } from "@/lib/scope";
import { memberInvoices } from "@/lib/member-invoice";

// GET — this member's invoices (Dimensie: per export; Stress: per Congressus
// invoice), each downloadable as a PDF to explain it to the member.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMemberAdmin();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const member = await prisma.member.findUnique({ where: { id }, select: { associationId: true } });
  if (!member || !inScope(ctx.scope, member.associationId)) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  return NextResponse.json({ invoices: await memberInvoices([id]) });
}
