import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { extractUsage } from "@/lib/verbruik";

// Extract usage numbers from an uploaded Alexia "Verbruiksformulier" PDF, to
// pre-fill the activity usage form. The file is parsed in memory and NOT stored —
// only the extracted { matched, unmatched } numbers are returned.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const { matched, unmatched } = extractUsage(text);
  if (matched.length === 0 && unmatched.length === 0) {
    return NextResponse.json(
      { error: "No usage numbers found — this doesn't look like an Alexia Verbruiksformulier." },
      { status: 422 }
    );
  }

  return NextResponse.json({ matched, unmatched });
}
