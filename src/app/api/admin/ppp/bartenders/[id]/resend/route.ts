import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { sendBartenderInviteEmail } from "@/lib/email";
import { randomUUID } from "crypto";

// Re-issue a fresh (non-expiring) set-password link and email it again.
// A new token invalidates any previously sent one.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "BARTENDER") {
    return NextResponse.json({ error: "Bartender not found" }, { status: 404 });
  }

  const token = randomUUID();
  // Upsert the single per-user token, resetting usedAt so the new link works.
  await prisma.passwordSetupToken.upsert({
    where: { userId: id },
    update: { token, usedAt: null, createdAt: new Date() },
    create: { userId: id, token },
  });

  try {
    await sendBartenderInviteEmail(user.email, token);
  } catch (err) {
    return NextResponse.json({ error: `Email failed: ${(err as Error).message}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
