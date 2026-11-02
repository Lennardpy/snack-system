import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { ASSOCIATION_IDS, type AssociationId } from "./associations";

// Member portal login (ppp.51vo.nl/user): "Log in with Congressus" of the member's
// association. Each association's Congressus is its own OAuth 2.0 provider, on the
// association's website domain:
//   <domain>/oauth/authorize · <domain>/oauth/token · <domain>/oauth/userinfo
// with a client registered in that Congressus (redirect URI:
// <PPP origin>/api/user/oauth/callback). Per association, from env:
//   CONGRESSUS_OAUTH_<ASSOC>_DOMAIN         e.g. https://www.svdimensie.nl
//   CONGRESSUS_OAUTH_<ASSOC>_CLIENT_ID / _CLIENT_SECRET
// An association without these simply has no login button.
//
// A portal session is separate from staff sessions: its own table and cookie, and
// it only reads the person's own purchases and invoices.

export const MEMBER_COOKIE = "member_session";
export const STATE_COOKIE = "member_oauth_state";
const SESSION_HOURS = 8;

export interface OAuthConfig {
  domain: string;
  clientId: string;
  clientSecret: string;
}

export function oauthConfig(association: AssociationId): OAuthConfig | null {
  const env = (k: string) => process.env[`CONGRESSUS_OAUTH_${association.toUpperCase()}_${k}`]?.trim();
  const domain = env("DOMAIN")?.replace(/\/+$/, "");
  const clientId = env("CLIENT_ID");
  const clientSecret = env("CLIENT_SECRET");
  if (!domain || !clientId || !clientSecret || !/^https?:\/\//.test(domain)) return null;
  return { domain, clientId, clientSecret };
}

export const loginAssociations = () => ASSOCIATION_IDS.filter((a) => oauthConfig(a) !== null);

export const newToken = () => randomBytes(32).toString("base64url");

export async function createMemberSession(memberId: string, associationId: AssociationId) {
  return prisma.memberSession.create({
    data: {
      token: newToken(),
      memberId,
      associationId,
      expiresAt: new Date(Date.now() + SESSION_HOURS * 3600 * 1000),
    },
  });
}

export const memberCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_HOURS * 3600,
};

// The signed-in member and every membership of the same person (same email, not
// deleted) — a dual member sees both associations' purchases and invoices.
export async function requireMember() {
  const token = (await cookies()).get(MEMBER_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.memberSession.findUnique({
    where: { token },
    include: { member: { select: { id: true, email: true, firstName: true, lastName: true, deletedAt: true } } },
  });
  if (!session || session.expiresAt < new Date() || session.member.deletedAt) return null;
  const memberships = await prisma.member.findMany({
    where: { email: { equals: session.member.email, mode: "insensitive" }, deletedAt: null },
    select: { id: true, associationId: true, active: true },
  });
  return { session, member: session.member, memberships };
}
