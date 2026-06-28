import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBartender } from "@/lib/auth";

// Soft-close / reopen / rename an activity. Body: { status?, name? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { status, name } = await req.json();

  const data: { status?: "OPEN" | "CLOSED"; name?: string } = {};

  if (status !== undefined) {
    if (status !== "OPEN" && status !== "CLOSED") {
      return NextResponse.json({ error: "status must be OPEN or CLOSED" }, { status: 400 });
    }
    data.status = status;
  }

  if (name !== undefined) {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    data.name = trimmed;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const activity = await prisma.pppActivity.update({ where: { id }, data });
    return NextResponse.json({ activity });
  } catch {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
}
