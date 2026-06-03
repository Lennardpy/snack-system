import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = req.nextUrl.searchParams.get("status") ?? "CONFIRMED";

  const invoices = await prisma.saleInvoice.findMany({
    where: { status: status as "CONFIRMED" | "EXPORTED" },
    include: {
      member: true,
      lines: { include: { product: true } },
    },
    orderBy: { confirmedAt: "desc" },
  });

  return NextResponse.json({ invoices });
}
