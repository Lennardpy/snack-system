import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

// Resolve orders left in EXPORTING ("needs check") after an export whose outcome
// was unknown. The admin first checks Congressus for that member's invoice, then:
//   • action "exported" — it IS in Congressus: mark EXPORTED (optionally with the
//     Congressus invoice id), so it's never exported again;
//   • action "pending"  — it is NOT in Congressus: back to CONFIRMED, so the next
//     export includes it.
// Only claims older than 10 minutes can be resolved, so a running export is never
// interfered with.
// Body: { system: "sss" | "ppp", ids: string[], action: "exported" | "pending",
//         congressusInvoiceId?: number }
const MIN_CLAIM_AGE_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const system = body.system === "ppp" ? "ppp" : body.system === "sss" ? "sss" : null;
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  const action = body.action === "exported" || body.action === "pending" ? body.action : null;
  if (!system || !action || ids.length === 0) {
    return NextResponse.json({ error: "Expected { system, ids, action }" }, { status: 400 });
  }
  const cidRaw = body.congressusInvoiceId;
  const congressusInvoiceId =
    cidRaw === undefined || cidRaw === null || cidRaw === "" ? null : Number(cidRaw);
  if (congressusInvoiceId !== null && !(Number.isInteger(congressusInvoiceId) && congressusInvoiceId > 0)) {
    return NextResponse.json({ error: "Congressus invoice id must be a number" }, { status: 400 });
  }

  const where = {
    id: { in: ids },
    status: "EXPORTING" as const,
    exportClaimedAt: { lt: new Date(Date.now() - MIN_CLAIM_AGE_MS) },
  };
  const data =
    action === "exported"
      ? { status: "EXPORTED" as const, exportedAt: new Date(), congressusInvoiceId, exportClaim: null }
      : { status: "CONFIRMED" as const, exportClaim: null, exportClaimedAt: null };

  const { count } =
    system === "sss"
      ? await prisma.saleInvoice.updateMany({ where, data })
      : await prisma.pppInvoice.updateMany({ where, data });

  if (count === 0) {
    return NextResponse.json(
      { error: "Nothing resolved — these orders aren't waiting for a check, or the export started less than 10 minutes ago." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, resolved: count });
}
