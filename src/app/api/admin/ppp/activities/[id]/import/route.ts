import { NextRequest, NextResponse } from "next/server";
import { requirePpp } from "@/lib/auth";
import { activityInScope } from "@/lib/scope-db";
import { extractUsage } from "@/lib/verbruik";
import { prisma } from "@/lib/prisma";
import { loadSbzLists, sbzListAt } from "@/lib/sbz-db";

// Extract usage numbers from an uploaded Alexia "Verbruiksformulier" PDF, to
// pre-fill the activity usage form. The file is parsed in memory and NOT stored —
// only the extracted { matched, unmatched } numbers are returned.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await activityInScope(id, ctx.scope))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  const activity = await prisma.pppActivity.findUnique({ where: { id }, select: { date: true } });
  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Expected a multipart file upload" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 413 });
  }

  let text: string;
  try {
    // Import lazily so the (heavy) PDF engine only loads when actually importing.
    const { getDocumentProxy, extractText } = await import("unpdf");
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const res = await extractText(pdf, { mergePages: true });
    text = res.text;
  } catch {
    return NextResponse.json({ error: "Could not read this PDF. Is it a valid Alexia usage form?" }, { status: 422 });
  }

  // Match against the SBZ price list valid on this borrel's date.
  const sbzItems = sbzListAt(await loadSbzLists(), activity.date)?.items ?? [];
  const { matched, unmatched } = extractUsage(text, sbzItems);
  if (matched.length === 0 && unmatched.length === 0) {
    return NextResponse.json(
      { error: "No usage numbers found — this doesn't look like an Alexia Verbruiksformulier." },
      { status: 422 }
    );
  }

  return NextResponse.json({ matched, unmatched });
}
