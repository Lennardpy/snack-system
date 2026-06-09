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

  // Confirm the invoice and decrement stock for each purchased product in one
  // transaction. Products with NULL stock (unlimited) are left untouched —
  // `stock - q` is NULL in SQL, so the WHERE guard skips them. Tracked stock is
  // clamped at 0 so it can't go negative even if more were bought than counted.
  await prisma.$transaction([
    prisma.saleInvoice.update({
      where: { id: invoice.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    }),
    ...invoice.lines.map(
      (line) =>
        prisma.$executeRaw`UPDATE "Product" SET stock = GREATEST(stock - ${line.quantity}, 0) WHERE id = ${line.productId} AND stock IS NOT NULL`,
    ),
  ]);

  // Clean up the shop session — tap card again to start fresh
  await prisma.shopSession.delete({ where: { token } });

  return NextResponse.json({ ok: true, invoiceId: invoice.id });
}
