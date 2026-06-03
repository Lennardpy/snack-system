import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendCardVerificationEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  const { uid, email } = await req.json();

  if (!uid || !email) {
    return NextResponse.json({ error: "Missing uid or email" }, { status: 400 });
  }

  const normalised = uid.trim().toUpperCase();

  // Check if already registered
  const existing = await prisma.card.findUnique({ where: { uid: normalised } });
  if (existing) {
    return NextResponse.json({ error: "Card already registered" }, { status: 409 });
  }

  // Look up member by email
  const member = await prisma.member.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  if (!member) {
    // Don't reveal whether the email exists — give the same success response
    // to avoid member enumeration. The email just won't arrive.
    return NextResponse.json({ ok: true });
  }

  if (!member.active) {
    return NextResponse.json({ error: "Member account is inactive" }, { status: 403 });
  }

  // Delete any previous pending registration for this card
  await prisma.cardRegistration.deleteMany({ where: { uid: normalised } });

  const registration = await prisma.cardRegistration.create({
    data: {
      uid: normalised,
      email: email.trim().toLowerCase(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    },
  });

  await sendCardVerificationEmail(member.email, member.firstName, registration.token);

  return NextResponse.json({ ok: true });
}
