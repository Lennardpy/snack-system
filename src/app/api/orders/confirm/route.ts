import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const session = await prisma.shopSession.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  const invoice = await prisma.saleInvoice.findFirst({
    where: { memberId: session.memberId, status: "CONCEPT" },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });

  if (!invoice || invoice.lines.length === 0) {
    return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
  }

  await prisma.saleInvoice.update({
    where: { id: invoice.id },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });

  // Clean up the shop session — tap card again to start fresh
  await prisma.shopSession.delete({ where: { token } });

  return NextResponse.json({ ok: true, invoiceId: invoice.id });
}
