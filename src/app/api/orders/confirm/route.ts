import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const session = await prisma.shopSession.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  // Everything in one transaction, with the cart row locked first: a concurrent
  // cart edit (src/app/api/cart/route.ts takes the same lock) or a second confirm
  // waits, then sees the cart is no longer a concept — so a confirmed invoice can't
  // change afterwards and stock is only reduced once.
  const result = await prisma.$transaction(async (tx) => {
    const draft = await tx.saleInvoice.findFirst({
      where: { memberId: session.memberId, status: "CONCEPT" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!draft) return { error: "Cart is empty", status: 400 } as const;
    const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "SaleInvoice" WHERE id = ${draft.id} FOR UPDATE`;
    if (locked?.status !== "CONCEPT") return { error: "This order was already confirmed", status: 409 } as const;

    const lines = await tx.invoiceLine.findMany({ where: { invoiceId: draft.id } });
    if (lines.length === 0) return { error: "Cart is empty", status: 400 } as const;

    // The total from the lines as they are now, not from an earlier read.
    await tx.saleInvoice.update({
      where: { id: draft.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        totalCents: lines.reduce((sum, l) => sum + l.quantity * l.unitCents, 0),
      },
    });
    // Products with NULL stock (unlimited) are left untouched — `stock - q` is NULL
    // in SQL, so the WHERE guard skips them. Tracked stock is clamped at 0.
    for (const line of lines) {
      await tx.$executeRaw`UPDATE "Product" SET stock = GREATEST(stock - ${line.quantity}, 0) WHERE id = ${line.productId} AND stock IS NOT NULL`;
    }
    // Tap the card again to start fresh.
    await tx.shopSession.deleteMany({ where: { token } });
    return { invoiceId: draft.id } as const;
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, invoiceId: result.invoiceId });
}
