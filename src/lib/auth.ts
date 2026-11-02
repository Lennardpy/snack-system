import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { prisma } from "./prisma";
import { siteForHost, type Site } from "./site";
import type { AssociationId } from "./associations";

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

// The site (SSS or PPP) this request is for, from its domain.
export async function currentSite(): Promise<Site> {
  return siteForHost((await headers()).get("host"));
}

export async function createSession(userId: string, kind: SessionKind, site: Site) {
  const now = Date.now();
  return prisma.session.create({
    data: {
      userId,
      kind,
      site,
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
  // A session only works on the site it was created on (separate logins).
  if (session.site !== (await currentSite())) return null;

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

// May this account sign in to this site? Admins need access to that site;
// bartenders only work on the PPP (the bar POS).
export function canUseSite(user: Pick<User, "role" | "sssAccess" | "pppAccess">, site: Site): boolean {
  if (user.role === "ADMIN") return site === "sss" ? user.sssAccess : user.pppAccess;
  if (user.role === "BARTENDER") return site === "ppp";
  return false;
}

// Where an account lands after signing in on a site.
export function homePath(user: Pick<User, "role">, site: Site): string {
  if (site === "sss") return "/admin";
  return user.role === "ADMIN" ? "/ppp/admin" : "/ppp";
}

// The overall admin: an admin account not tied to an association. Sees every
// association and manages accounts.
export const isOverallAdmin = (user: Pick<User, "role" | "associationId">) =>
  user.role === "ADMIN" && user.associationId === null;

// SSS admin (snack system, Stress only): an admin with SSS access, on the SSS site.
export async function requireSss() {
  const session = await getSession();
  if (!session || session.site !== "sss") return null;
  const { user } = session;
  if (user.role !== "ADMIN" || !user.sssAccess) return null;
  return user;
}

// PPP admin (bar system): an admin with PPP access, on the PPP site. `scope` is
// the association whose data they see — null for the overall admin (everything).
export async function requirePpp(): Promise<{ user: User; scope: AssociationId | null } | null> {
  const session = await getSession();
  if (!session || session.site !== "ppp") return null;
  const { user } = session;
  if (user.role !== "ADMIN" || !user.pppAccess) return null;
  return { user, scope: (user.associationId as AssociationId | null) ?? null };
}

// Member admin on either site: the SSS admin manages Stress members (the kiosk is
// Stress-only), a PPP admin the members of its scope.
export async function requireMemberAdmin(): Promise<{ user: User; scope: AssociationId | null; site: Site } | null> {
  const sss = await requireSss();
  if (sss) return { user: sss, scope: "stress", site: "sss" };
  const ppp = await requirePpp();
  return ppp ? { ...ppp, site: "ppp" } : null;
}

// The Stress export (one combined SSS + PPP invoice per Stress member): from the
// SSS admin, or a PPP admin on the Stress side.
export async function requireStressExporter() {
  const sss = await requireSss();
  if (sss) return sss;
  const ppp = await requirePpp();
  return ppp && (ppp.scope === null || ppp.scope === "stress") ? ppp.user : null;
}

// The overall admin, on either site (account management).
export async function requireOverallAdmin() {
  const session = await getSession();
  if (!session || !isOverallAdmin(session.user) || !canUseSite(session.user, session.site as Site)) return null;
  return session.user;
}

// Bar POS: bartenders, and PPP admins (who can do everything a bartender can).
// Returns the user, or null if not signed in on the PPP site with a sufficient role.
export async function requireBartender() {
  const session = await getSession();
  if (!session || session.site !== "ppp") return null;
  if (!canUseSite(session.user, "ppp")) return null;
  return session.user;
}
