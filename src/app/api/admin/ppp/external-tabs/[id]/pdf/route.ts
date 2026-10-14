import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { loadExternalTabs } from "@/lib/external-db";
import { externalTabTitle, renderExternalTabPdf } from "@/lib/external-pdf";

// Download the PDF statement for an external tab (title, drinks, prices at the
// tab's price level, excl./incl. VAT).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [tab] = await loadExternalTabs({ id });
  if (!tab) return NextResponse.json({ error: "Tab not found" }, { status: 404 });

  const pdf = await renderExternalTabPdf(tab);
  const slug =
    externalTabTitle(tab)
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "external-tab";
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${slug}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
