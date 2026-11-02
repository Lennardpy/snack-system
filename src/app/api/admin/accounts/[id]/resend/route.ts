import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireOverallAdmin } from "@/lib/auth";
import { sendAccountInviteEmail } from "@/lib/email";

// Re-issue a fresh (non-expiring) set-password link for an admin login and email
// it again; the new token invalidates the previous one. Also works as a
// "reset password" link for an account that already has one.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireOverallAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const user = await prisma.user.findFirst({ where: { id, role: "ADMIN" } });
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const token = randomUUID();
  await prisma.passwordSetupToken.upsert({
    where: { userId: id },
    update: { token, usedAt: null, createdAt: new Date() },
    create: { userId: id, token },
  });

  try {
    await sendAccountInviteEmail(user.email, token, user.pppAccess ? "ppp" : "sss");
  } catch (err) {
    return NextResponse.json({ error: `Email failed: ${(err as Error).message}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
