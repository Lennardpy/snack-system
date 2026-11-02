import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { userWhere } from "@/lib/scope";
import { sendAccountInviteEmail } from "@/lib/email";
import { randomUUID } from "crypto";

// Re-issue a fresh (non-expiring) set-password link and email it again.
// A new token invalidates any previously sent one.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const user = await prisma.user.findFirst({ where: { id, ...userWhere(ctx.scope) } });
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
    await sendAccountInviteEmail(user.email, token);
  } catch (err) {
    return NextResponse.json({ error: `Email failed: ${(err as Error).message}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
