import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Always use the canonical public URL so the confirmation form and redirect
// work correctly regardless of where the email link was opened (e.g. on a
// phone that can't reach localhost).
const BASE_URL =
  process.env.BASE_URL ??
  process.env.NEXT_PUBLIC_BASE_URL ??
  "http://localhost:3000";

// ── GET: show confirmation page ───────────────────────────────────────────────
// Email clients (Gmail, Outlook, Apple Mail) pre-fetch links to scan for
// malware. A GET that performs the action would link the card before the user
// ever clicks. Instead the GET only validates the token and renders a
// confirmation page; the card is only linked on the subsequent POST.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return new NextResponse(errorPage("Missing token."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const registration = await prisma.cardRegistration.findUnique({
    where: { token },
  });

  if (!registration) {
    return new NextResponse(errorPage("Invalid or expired link."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (registration.expiresAt < new Date()) {
    return new NextResponse(
      errorPage("This link has expired. Please tap your card again to request a new one."),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  if (registration.usedAt) {
    return new NextResponse(errorPage("This link has already been used."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Token is valid — show confirmation page with a POST form
  return new NextResponse(confirmPage(token, BASE_URL), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ── POST: link the card ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const token = formData.get("token") as string | null;

  if (!token) {
    return new NextResponse(errorPage("Missing token."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const registration = await prisma.cardRegistration.findUnique({
    where: { token },
  });

  if (!registration) {
    return new NextResponse(errorPage("Invalid or expired link."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (registration.expiresAt < new Date()) {
    return new NextResponse(
      errorPage("This link has expired. Please tap your card again to request a new one."),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  if (registration.usedAt) {
    return new NextResponse(errorPage("This link has already been used."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Find the member
  const member = await prisma.member.findUnique({
    where: { associationId_email: { associationId: "stress", email: registration.email } },
  });

  if (!member) {
    return new NextResponse(errorPage("Member account not found."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Guard against race condition: card registered between email send and click
  const existingCard = await prisma.card.findUnique({ where: { uid: registration.uid } });
  const externalCard = await prisma.externalCard.findUnique({ where: { uid: registration.uid } });
  if (existingCard || externalCard) {
    await prisma.cardRegistration.update({ where: { token }, data: { usedAt: new Date() } });
    return new NextResponse(errorPage("This card is already registered to an account."), {
      status: 409,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Link the card and mark registration as used
  await prisma.card.create({
    data: { uid: registration.uid, memberId: member.id, name: "Student card" },
  });

  await prisma.cardRegistration.update({ where: { token }, data: { usedAt: new Date() } });

  // Show success — do NOT create a shop session here. The shop is only
  // accessible by physically tapping the card at the kiosk.
  return new NextResponse(successPage(escapeHtml(member.firstName)), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

// Escape any value interpolated into an HTML response to prevent injection.
// Member names come from Congressus and are not guaranteed to be markup-safe.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function confirmPage(token: string, baseUrl: string) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Link your card — SSS</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: sans-serif; background: #030712; color: white;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; padding: 24px;
    }
    .box { text-align: center; max-width: 420px; width: 100%; }
    .icon { font-size: 4rem; margin-bottom: 16px; }
    h1 { font-size: 1.5rem; margin: 0 0 8px; }
    p { color: #9ca3af; margin: 0 0 32px; line-height: 1.5; }
    button {
      background: #16a34a; color: white; border: none; cursor: pointer;
      padding: 14px 32px; border-radius: 12px; font-size: 1rem;
      font-weight: bold; width: 100%; transition: background 0.15s;
    }
    button:hover { background: #15803d; }
    button:active { background: #166534; }
    .footer { color: #374151; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">🪪</div>
    <h1>Link your card</h1>
    <p>Click the button below to link your student card to your SSS account.<br/>You'll be taken straight to the shop.</p>
    <form method="POST" action="${escapeHtml(baseUrl)}/api/card/verify">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <button type="submit">Yes, link my card</button>
    </form>
    <p class="footer">SSS &mdash; Stress Snack System</p>
  </div>
</body>
</html>`;
}

function successPage(firstName: string) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Card linked — SSS</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: sans-serif; background: #030712; color: white;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; padding: 24px;
    }
    .box { text-align: center; max-width: 420px; width: 100%; }
    .icon { font-size: 4rem; margin-bottom: 16px; }
    h1 { font-size: 1.5rem; margin: 0 0 8px; }
    p { color: #9ca3af; margin: 0 0 12px; line-height: 1.5; }
    .footer { color: #374151; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">✅</div>
    <h1>Card linked, ${firstName}!</h1>
    <p>Your student card is now linked to your SSS account.</p>
    <p>Tap your card at the kiosk to start shopping.</p>
    <p class="footer">SSS &mdash; Stress Snack System</p>
  </div>
</body>
</html>`;
}

function errorPage(message: string) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Card registration — SSS</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: sans-serif; background: #030712; color: white;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; padding: 24px;
    }
    .box { text-align: center; max-width: 400px; width: 100%; }
    h1 { font-size: 1.5rem; margin-bottom: 12px; color: #f87171; }
    p { color: #9ca3af; }
    a { color: #60a5fa; }
    .footer { color: #374151; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>❌ Registration failed</h1>
    <p>${message}</p>
    <p><a href="/">Back to SSS</a></p>
    <p class="footer">SSS &mdash; Stress Snack System</p>
  </div>
</body>
</html>`;
}
