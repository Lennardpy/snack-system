import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendCardVerificationEmail } from "@/lib/email";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  // Rate-limit per IP to prevent email-enumeration probing and mail-bombing.
  if (!rateLimit(`register:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

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

  // Don't reveal whether the email belongs to a member (or an active one) —
  // return the same generic success either way to prevent enumeration. If there
  // is no matching active member, no email is sent.
  if (!member || !member.active) {
    return NextResponse.json({ ok: true });
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
