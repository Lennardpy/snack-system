import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMemberAdmin } from "@/lib/auth";
import { inScope } from "@/lib/scope";
import { invoiceFileName, memberInvoice, renderMemberInvoicePdf } from "@/lib/member-invoice";

// GET — one of this member's invoices as a PDF (with the association's logo).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const ctx = await requireMemberAdmin();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, key } = await params;
  const member = await prisma.member.findUnique({ where: { id }, select: { associationId: true } });
  if (!member || !inScope(ctx.scope, member.associationId)) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const inv = await memberInvoice([id], key);
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(await renderMemberInvoicePdf(inv)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoiceFileName(inv)}"`,
      "Cache-Control": "no-store",
    },
  });
}
