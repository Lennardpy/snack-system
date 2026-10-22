import type { Prisma } from "@prisma/client";
import { isAssociationId, ASSOCIATION_LABEL, type AssociationId } from "./associations";

// Shared helpers for the admin-account routes (/api/admin/accounts).

export const accountSelect = {
  id: true,
  email: true,
  sssAccess: true,
  pppAccess: true,
  associationId: true,
  createdAt: true,
  passwordSetup: { select: { usedAt: true } },
} satisfies Prisma.UserSelect;

type AccountRow = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

export function accountView(u: AccountRow, selfId: string) {
  return {
    id: u.id,
    email: u.email,
    sssAccess: u.sssAccess,
    pppAccess: u.pppAccess,
    associationId: u.associationId,
    association: u.associationId ? ASSOCIATION_LABEL[u.associationId as AssociationId] : "All (overall admin)",
    passwordSet: !u.passwordSetup || u.passwordSetup.usedAt != null,
    createdAt: u.createdAt,
    self: u.id === selfId,
  };
}

// Validate { sssAccess, pppAccess, associationId } from a request body.
// associationId null = the overall admin (every association, manages accounts).
// The SSS is Stress's, so Dimensie accounts can't have SSS access.
export function parseAccess(body: Record<string, unknown>):
  | { sssAccess: boolean; pppAccess: boolean; associationId: AssociationId | null }
  | { error: string } {
  const sssAccess = body.sssAccess === true;
  const pppAccess = body.pppAccess === true;
  const raw = body.associationId ?? null;
  if (raw !== null && !isAssociationId(raw)) return { error: "Unknown association" };
  const associationId = raw as AssociationId | null;
  if (!sssAccess && !pppAccess) return { error: "Give the account access to at least one site" };
  if (sssAccess && associationId === "dimensie") return { error: "Dimensie accounts can't use the snack system (SSS)" };
  return { sssAccess, pppAccess, associationId };
}
