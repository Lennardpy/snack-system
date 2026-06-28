import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { sendBartenderInviteEmail } from "@/lib/email";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

// List bartender accounts with their invite status.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const users = await prisma.user.findMany({
    where: { role: "BARTENDER" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      createdAt: true,
      passwordSetup: { select: { usedAt: true } },
    },
  });

  // "pending" = an invite token exists that hasn't been used yet.
  const bartenders = users.map((u) => ({
    id: u.id,
    email: u.email,
    createdAt: u.createdAt,
    passwordSet: !u.passwordSetup || u.passwordSetup.usedAt != null,
  }));

  return NextResponse.json({ bartenders });
}

// Create a bartender by email and send a (non-expiring) set-password link.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { email } = await req.json();
  const normalised = (email ?? "").trim().toLowerCase();
  if (!normalised || !normalised.includes("@")) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: normalised } });
  if (existing) {
    return NextResponse.json(
      { error: "A user with that email already exists" },
      { status: 409 }
    );
  }

  // Create the account with an unusable random password — it can only be used
  // once the bartender sets their own via the emailed link.
  const placeholder = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  const user = await prisma.user.create({
    data: {
      email: normalised,
      role: "BARTENDER",
      passwordHash: placeholder,
      passwordSetup: { create: {} },
    },
    select: { id: true, email: true, passwordSetup: { select: { token: true } } },
  });

  try {
    await sendBartenderInviteEmail(user.email, user.passwordSetup!.token);
  } catch (err) {
    // Account exists; surface the email failure so the admin can resend.
    return NextResponse.json({
      bartender: { id: user.id, email: user.email, passwordSet: false },
      warning: `Account created but the invite email failed: ${(err as Error).message}. Use "Resend".`,
    });
  }

  return NextResponse.json({
    bartender: { id: user.id, email: user.email, passwordSet: false },
  });
}
