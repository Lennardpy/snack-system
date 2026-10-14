import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { loadExternalTabs } from "@/lib/external-db";

// External tabs at this borrel (one per external card used), priced at each tab's level.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  return NextResponse.json({ tabs: await loadExternalTabs({ activityId: id }) });
}
