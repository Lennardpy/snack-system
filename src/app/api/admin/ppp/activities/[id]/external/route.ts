import { NextRequest, NextResponse } from "next/server";
import { requirePpp } from "@/lib/auth";
import { activityInScope } from "@/lib/scope-db";
import { isStressSide } from "@/lib/scope";
import { loadExternalTabs } from "@/lib/external-db";

// External tabs at this borrel (one per external card used), priced at each tab's level.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStressSide(ctx.scope)) {
    return NextResponse.json({ error: "Not available for this association" }, { status: 403 });
  }

  const { id } = await params;
  if (!(await activityInScope(id, ctx.scope))) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  return NextResponse.json({ tabs: await loadExternalTabs({ activityId: id }) });
}
