import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// Resolve orders left in EXPORTING ("needs a check") after an export whose outcome
// was unknown. One Congressus invoice holds a member-month's SSS AND PPP orders, so
// both id sets are resolved together. The admin first checks Congressus, then:
//   • action "exported" — it IS in Congressus: mark EXPORTED (optionally with the
//     Congressus invoice id), so it's never exported again;
//   • action "pending"  — it is NOT in Congressus: back to CONFIRMED, so the next
//     export includes it.
// Only claims older than 10 minutes can be resolved, so a running export is never
// interfered with.
// Body: { sssIds?: string[], pppIds?: string[], action: "exported" | "pending",
//         congressusInvoiceId?: number }
const MIN_CLAIM_AGE_MS = 10 * 60 * 1000;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sssIds = strings(body.sssIds);
  const pppIds = strings(body.pppIds);
  const action = body.action === "exported" || body.action === "pending" ? body.action : null;
  if (!action || sssIds.length + pppIds.length === 0) {
    return NextResponse.json({ error: "Expected { sssIds, pppIds, action }" }, { status: 400 });
  }
  const cidRaw = body.congressusInvoiceId;
  const congressusInvoiceId =
    cidRaw === undefined || cidRaw === null || cidRaw === "" ? null : Number(cidRaw);
  if (congressusInvoiceId !== null && !(Number.isInteger(congressusInvoiceId) && congressusInvoiceId > 0)) {
    return NextResponse.json({ error: "Congressus invoice id must be a number" }, { status: 400 });
  }

  const ready = {
    status: "EXPORTING" as const,
    exportClaimedAt: { lt: new Date(Date.now() - MIN_CLAIM_AGE_MS) },
  };
  const data =
    action === "exported"
      ? { status: "EXPORTED" as const, exportedAt: new Date(), congressusInvoiceId, exportClaim: null }
      : { status: "CONFIRMED" as const, exportClaim: null, exportClaimedAt: null };

  const [sss, ppp] = await prisma.$transaction([
    prisma.saleInvoice.updateMany({ where: { id: { in: sssIds }, ...ready }, data }),
    prisma.pppInvoice.updateMany({ where: { id: { in: pppIds }, ...ready }, data }),
  ]);
  const resolved = sss.count + ppp.count;

  if (resolved === 0) {
    return NextResponse.json(
      { error: "Nothing resolved — these orders aren't waiting for a check, or the export started less than 10 minutes ago." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, resolved });
}
