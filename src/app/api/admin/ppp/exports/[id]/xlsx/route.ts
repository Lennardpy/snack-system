import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { renderSheet, sheetRows } from "@/lib/export-sheet";

// GET — the Excel sheet of one export (contains IBANs: only for that
// association's admins and the overall admin; never cached).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const batch = await prisma.pppExportBatch.findUnique({ where: { id } });
  if (!batch || (ctx.scope !== null && batch.associationId !== ctx.scope)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const file = await renderSheet(batch, await sheetRows(batch.id));
  console.log(`[export] sheet ${batch.number} downloaded by user ${ctx.user.id}`);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${batch.number}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
