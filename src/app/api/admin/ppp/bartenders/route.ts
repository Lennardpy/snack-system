import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePpp } from "@/lib/auth";
import { sendAccountInviteEmail } from "@/lib/email";
import { userWhere } from "@/lib/scope";
import { isAssociationId, ASSOCIATION_LABEL, type AssociationId } from "@/lib/associations";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

// List bartender accounts with their invite status.
export async function GET() {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const users = await prisma.user.findMany({
    where: { role: "BARTENDER", ...userWhere(ctx.scope) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      associationId: true,
      createdAt: true,
      passwordSetup: { select: { usedAt: true } },
      member: {
        select: { id: true, firstName: true, lastName: true, email: true, cards: { select: { id: true } } },
      },
    },
  });

  // "pending" = an invite token exists that hasn't been used yet.
  const bartenders = users.map((u) => ({
    id: u.id,
    email: u.email,
    association: u.associationId ? ASSOCIATION_LABEL[u.associationId as AssociationId] : null,
    createdAt: u.createdAt,
    passwordSet: !u.passwordSetup || u.passwordSetup.usedAt != null,
    member: u.member
      ? {
          id: u.member.id,
          name: `${u.member.firstName} ${u.member.lastName}`.trim(),
          email: u.member.email,
          cardCount: u.member.cards.length,
        }
      : null,
  }));

  return NextResponse.json({ bartenders });
}

// Create a bartender by email and send a (non-expiring) set-password link.
export async function POST(req: NextRequest) {
  const ctx = await requirePpp();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { email, association } = await req.json();
  // A bartender works for the login's association; the overall admin picks one.
  const associationId = ctx.scope ?? (isAssociationId(association) ? association : "stress");
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
      associationId,
      pppAccess: true,
      passwordHash: placeholder,
      passwordSetup: { create: {} },
    },
    select: { id: true, email: true, passwordSetup: { select: { token: true } } },
  });

  try {
    await sendAccountInviteEmail(user.email, user.passwordSetup!.token);
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
