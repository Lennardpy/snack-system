import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { prisma } from "./prisma";

// Session lifetimes.
//   • "password" — email/password login (admin panel, bartenders): 7 days.
//   • "card"     — bar POS card tap: sliding, ends after 2 h without any request
//                  (the open POS polls every 10 s, so it stays alive while in use)
//                  and never lasts longer than 16 h — a card login never outlives
//                  the borrel or lingers on the shared bar PC until next week.
const PASSWORD_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const CARD_IDLE_MS = 2 * 60 * 60 * 1000;
const CARD_MAX_MS = 16 * 60 * 60 * 1000;
// Only write the extended expiry when it moved by at least this much, so the POS
// polling doesn't update the session row every 10 s.
const SLIDE_STEP_MS = 5 * 60 * 1000;

export type SessionKind = "password" | "card";

export async function createSession(userId: string, kind: SessionKind) {
  const now = Date.now();
  return prisma.session.create({
    data: {
      userId,
      kind,
      expiresAt: new Date(now + (kind === "card" ? CARD_IDLE_MS : PASSWORD_SESSION_MS)),
    },
  });
}

// Set the session cookie. Secure in production (HTTPS only). For card sessions the
// cookie lives for the 16 h maximum; the server-side expiry decides validity.
export function setSessionCookie(
  res: NextResponse,
  session: { token: string; kind: string; expiresAt: Date; createdAt: Date }
) {
  const expires =
    session.kind === "card" ? new Date(session.createdAt.getTime() + CARD_MAX_MS) : session.expiresAt;
  res.cookies.set("session", session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  const now = Date.now();
  if (!session || session.expiresAt.getTime() < now) return null;

  // Card sessions slide: each use pushes the expiry to now + 2 h (capped at 16 h
  // after login).
  if (session.kind === "card") {
    const next = Math.min(now + CARD_IDLE_MS, session.createdAt.getTime() + CARD_MAX_MS);
    if (next - session.expiresAt.getTime() >= SLIDE_STEP_MS) {
      await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(next) } });
      session.expiresAt = new Date(next);
    }
  }
  return session;
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") return null;
  return session.user;
}

// PPP routes: bartenders operate the bar POS; admins can do everything a
// bartender can. Returns the user, or null if not signed in with a sufficient role.
export async function requireBartender() {
  const session = await getSession();
  if (!session) return null;
  const { role } = session.user;
  if (role !== "ADMIN" && role !== "BARTENDER") return null;
  return session.user;
}
