import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireOverallAdmin } from "@/lib/auth";
import { sendAccountInviteEmail } from "@/lib/email";
import { parseAccess, accountView, accountSelect } from "@/lib/accounts";

// Admin logins (overall admin only). Each account has access to the SSS admin,
// the PPP admin or both, and works for one association (null = everything).
// Bartenders are managed on the PPP Bartenders page.
export async function GET() {
  const admin = await requireOverallAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const users = await prisma.user.findMany({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: accountSelect,
  });
  return NextResponse.json({ accounts: users.map((u) => accountView(u, admin.id)) });
}

// Create an admin login and email a (non-expiring) set-password link for the
// site it uses. Body: { email, sssAccess, pppAccess, associationId }
export async function POST(req: NextRequest) {
  const admin = await requireOverallAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  const access = parseAccess(body);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: 400 });

  if (await prisma.user.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
  }

  // Unusable random password until they set their own via the emailed link.
  const user = await prisma.user.create({
    data: {
      email,
      role: "ADMIN",
      ...access,
      passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
      passwordSetup: { create: {} },
    },
    select: { ...accountSelect, passwordSetup: { select: { token: true, usedAt: true } } },
  });

  try {
    await sendAccountInviteEmail(user.email, user.passwordSetup!.token, user.pppAccess ? "ppp" : "sss");
  } catch (err) {
    return NextResponse.json({
      account: accountView(user, admin.id),
      warning: `Account created but the invite email failed: ${(err as Error).message}. Use "Resend".`,
    });
  }
  return NextResponse.json({ account: accountView(user, admin.id) });
}
