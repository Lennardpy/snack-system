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

  // No member with this email — tell the user so they can correct a typo.
  // (This trades a small amount of email-enumeration resistance for usability;
  // the endpoint is rate-limited to mitigate abuse.)
  if (!member) {
    return NextResponse.json({ code: "EMAIL_NOT_FOUND", error: "Email not found" }, { status: 404 });
  }

  // Member exists but is inactive — can't register; point them to the board.
  if (!member.active) {
    return NextResponse.json(
      { code: "INACTIVE", error: "This membership is inactive. Please contact the board." },
      { status: 403 }
    );
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
