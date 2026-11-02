import { NextRequest, NextResponse } from "next/server";
import { requirePpp, requireStressExporter } from "@/lib/auth";
import { pickAssociation } from "@/lib/associations";
import { exportAssociation } from "@/lib/export-run";

// The export button: bills ALL pending orders of one association. Body:
// { association } ("stress" default | "dimensie"). Stress → Congressus (SSS admin or
// Stress-side PPP admin); Dimensie → an Excel export sheet (Dimensie/overall PPP
// admin). The logic, shared with the monthly run, is in src/lib/export-run.ts.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const association = pickAssociation(body?.association);
  let userId: string;
  if (association === "stress") {
    const user = await requireStressExporter();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    userId = user.id;
  } else {
    const ppp = await requirePpp();
    if (!ppp || (ppp.scope !== null && ppp.scope !== association)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = ppp.user.id;
  }
  const result = await exportAssociation(association, userId);
  return NextResponse.json(result.body, { status: result.status });
}
