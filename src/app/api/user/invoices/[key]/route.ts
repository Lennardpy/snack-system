import { NextResponse } from "next/server";
import { requireMember } from "@/lib/member-auth";
import { invoiceFileName, memberInvoice, renderMemberInvoicePdf } from "@/lib/member-invoice";

// GET /api/user/invoices/<key> — one of the signed-in person's own invoices as PDF.
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await requireMember();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { key } = await params;
  const inv = await memberInvoice(
    ctx.memberships.map((m) => m.id),
    key
  );
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(await renderMemberInvoicePdf(inv)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoiceFileName(inv)}"`,
      "Cache-Control": "no-store",
    },
  });
}
