import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { loadSbzLists } from "@/lib/sbz-db";
import { matchSbzRows, parseSbzPriceList } from "@/lib/sbz-pdf";

// Read an uploaded SBZ price-list PDF: returns its rows (new prices) matched to the
// items of the newest list, plus the "effective" date and title from the header.
// Nothing is saved — the admin reviews it on the SBZ page first. The file is parsed
// in memory and not stored.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let file: File | null = null;
  try {
    const f = (await req.formData()).get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Expected a multipart file upload" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 413 });

  let text: string;
  try {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    text = (await extractText(pdf, { mergePages: true })).text;
  } catch {
    return NextResponse.json({ error: "Could not read this PDF." }, { status: 422 });
  }

  const parsed = parseSbzPriceList(text);
  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "No prices found — this doesn't look like an SBZ price list." },
      { status: 422 }
    );
  }
  const [newest] = await loadSbzLists();
  return NextResponse.json({
    fileName: file.name,
    label: parsed.label,
    validFrom: parsed.validFrom,
    baseListId: newest?.id ?? null,
    rows: matchSbzRows(parsed.rows, newest?.items ?? []),
  });
}
