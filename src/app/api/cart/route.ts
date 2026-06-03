import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

async function resolveSession(token: string) {
  const session = await prisma.shopSession.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
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

  // Get or create the concept invoice
  let invoice = await prisma.saleInvoice.findFirst({
    where: { memberId: session.memberId, status: "CONCEPT" },
    orderBy: { createdAt: "desc" },
  });

  if (!invoice) {
    invoice = await prisma.saleInvoice.create({
      data: { memberId: session.memberId },
    });
  }

  // Upsert the line
  const existing = await prisma.invoiceLine.findFirst({
    where: { invoiceId: invoice.id, productId },
  });

  if (existing) {
    const newQty = existing.quantity + delta;
    if (newQty <= 0) {
      await prisma.invoiceLine.delete({ where: { id: existing.id } });
    } else {
      await prisma.invoiceLine.update({
        where: { id: existing.id },
        data: { quantity: newQty },
      });
    }
  } else if (delta > 0) {
    await prisma.invoiceLine.create({
      data: {
        invoiceId: invoice.id,
        productId,
        quantity: delta,
        unitCents: product.price,
      },
    });
  }

  // Recalculate total
  const lines = await prisma.invoiceLine.findMany({ where: { invoiceId: invoice.id } });
  const total = lines.reduce((sum, l) => sum + l.quantity * l.unitCents, 0);

  await prisma.saleInvoice.update({
    where: { id: invoice.id },
    data: { totalCents: total },
  });

  // Extend session on activity
  await prisma.shopSession.update({
    where: { token },
    data: { expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  });

  return NextResponse.json({ ok: true, totalCents: total });
}
