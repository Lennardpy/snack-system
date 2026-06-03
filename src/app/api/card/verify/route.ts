import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return new NextResponse("Missing token", { status: 400 });
  }

  const registration = await prisma.cardRegistration.findUnique({
    where: { token },
  });

  if (!registration) {
    return new NextResponse(errorPage("Invalid or expired link."), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (registration.expiresAt < new Date()) {
    return new NextResponse(errorPage("This link has expired. Please tap your card again."), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (registration.usedAt) {
    return new NextResponse(errorPage("This link has already been used."), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Find the member
  const member = await prisma.member.findUnique({
    where: { email: registration.email },
  });

  if (!member) {
    return new NextResponse(errorPage("Member account not found."), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Check card isn't already registered (race condition guard)
  const existingCard = await prisma.card.findUnique({ where: { uid: registration.uid } });
  if (existingCard) {
    await prisma.cardRegistration.update({ where: { token }, data: { usedAt: new Date() } });
    return new NextResponse(errorPage("Card already registered to an account."), {
      status: 409,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Link the card
  await prisma.card.create({
    data: { uid: registration.uid, memberId: member.id, name: "Student card" },
  });

  // Mark registration as used
  await prisma.cardRegistration.update({ where: { token }, data: { usedAt: new Date() } });

  // Create a shop session so they land straight in the shop
  const session = await prisma.shopSession.create({
    data: {
      memberId: member.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  // Redirect straight into the shop
  return NextResponse.redirect(
    new URL(`/shop/${session.token}`, req.url)
  );
}

function errorPage(message: string) {
  return `<!DOCTYPE html>
<html>
<head><title>Card registration</title>
<style>
  body { font-family: sans-serif; background: #030712; color: white; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .box { text-align: center; max-width: 400px; padding: 32px; }
  h1 { font-size: 1.5rem; margin-bottom: 12px; color: #f87171; }
  a { color: #60a5fa; }
</style>
</head>
<body>
  <div class="box">
    <h1>❌ Registration failed</h1>
    <p>${message}</p>
    <p><a href="/">Go back to SSS</a></p>
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">SSS &mdash; Stress Snack System</p>
  </div>
</body>
</html>`;
}
