import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { effectivePriceCents } from "@/lib/pricing";

async function resolveSession(token: string) {
  const session = await prisma.shopSession.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

// DELETE /api/cart?token=xxx — end the shop session (idle timeout / leaving).
// The unconfirmed CONCEPT invoice is left untouched; it is never charged and is
// superseded by a fresh one on the next scan. Always returns ok so the kiosk can
// reset even if the session was already gone.
export async function DELETE(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (token) {
    await prisma.shopSession.deleteMany({ where: { token } });
  }
  return NextResponse.json({ ok: true });
}

// GET /api/cart?token=xxx — return current cart (concept invoice + lines)
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const session = await resolveSession(token);
  if (!session) return NextResponse.json({ error: "Session expired" }, { status: 401 });

  const [member, invoice] = await Promise.all([
    prisma.member.findUnique({
      where: { id: session.memberId },
      select: { firstName: true },
    }),
    prisma.saleInvoice.findFirst({
      where: { memberId: session.memberId, status: "CONCEPT" },
      include: { lines: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Member name is only returned here, behind a valid shop-session token —
  // never from the unauthenticated /api/card/scan endpoint.
  return NextResponse.json({ invoice, memberFirstName: member?.firstName ?? null });
}

// POST /api/cart — add or remove a product
// body: { token, productId, delta } where delta is +1 or -1
export async function POST(req: NextRequest) {
  const { token, productId, delta } = await req.json();

  if (!token || !productId || delta === undefined) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const session = await resolveSession(token);
  if (!session) return NextResponse.json({ error: "Session expired" }, { status: 401 });

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || !product.published || product.archived) {
    return NextResponse.json({ error: "Product unavailable" }, { status: 404 });
  }

  // Get or create the concept invoice and change it in one transaction, with the
  // invoice row locked (the confirm route takes the same lock): once a cart is
  // confirmed it can't be changed any more.
  const result = await prisma.$transaction(async (tx) => {
    let invoice = await tx.saleInvoice.findFirst({
      where: { memberId: session.memberId, status: "CONCEPT" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!invoice) {
      if (delta <= 0) return { totalCents: 0 };
      invoice = await tx.saleInvoice.create({ data: { memberId: session.memberId }, select: { id: true } });
    }
    const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "SaleInvoice" WHERE id = ${invoice.id} FOR UPDATE`;
    if (locked?.status !== "CONCEPT") return null;

    // Upsert the line
    const existing = await tx.invoiceLine.findFirst({ where: { invoiceId: invoice.id, productId } });
    if (existing) {
      const newQty = existing.quantity + delta;
      if (newQty <= 0) {
        await tx.invoiceLine.delete({ where: { id: existing.id } });
      } else {
        await tx.invoiceLine.update({ where: { id: existing.id }, data: { quantity: newQty } });
      }
    } else if (delta > 0) {
      await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          productId,
          quantity: delta,
          // Snapshot the price actually charged — discounted if the product is in
          // its final week / past its best-before date.
          unitCents: effectivePriceCents(product.price, product.expiresAt),
        },
      });
    }

    // Recalculate total
    const lines = await tx.invoiceLine.findMany({ where: { invoiceId: invoice.id } });
    const totalCents = lines.reduce((sum, l) => sum + l.quantity * l.unitCents, 0);
    await tx.saleInvoice.update({ where: { id: invoice.id }, data: { totalCents } });
    return { totalCents };
  });
  if (!result) return NextResponse.json({ error: "This order was already confirmed" }, { status: 409 });
  const total = result.totalCents;

  // Extend session on activity
  await prisma.shopSession.update({
    where: { token },
    data: { expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  });

  return NextResponse.json({ ok: true, totalCents: total });
}
