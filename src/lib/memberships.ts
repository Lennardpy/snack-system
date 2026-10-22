import { prisma } from "./prisma";
import { ASSOCIATION_LABEL, type AssociationId } from "./associations";

// Someone who is a member of both Stress and Dimensie has one Member row per
// association (one per Congressus). The rows are recognised as the same person by
// their email, so ONE card works for both memberships: whichever row the card is
// linked to, the bar charges the membership that may pay at that borrel.
//
// Who pays where:
//   • Stress borrel   → Stress members only.
//   • Dimensie borrel → Dimensie members only.
//   • Joint borrel    → both; someone in both associations is charged as a
//                       STRESS member (no detour via Dimensie's invoice).

const roleSelect = { name: true, discountPercent: true, discountCents: true, ownDrinkOnly: true, color: true } as const;
const memberSelect = {
  id: true,
  associationId: true,
  firstName: true,
  lastName: true,
  email: true,
  active: true,
  roles: { select: roleSelect },
} as const;

export interface BorrelHost {
  associationId: string;
  joint: boolean;
}

// The associations whose members may pay at a borrel, most preferred first.
export function payingAssociations(activity: BorrelHost): AssociationId[] {
  if (activity.joint) return ["stress", "dimensie"];
  return [activity.associationId as AssociationId];
}

// All memberships of the person behind a member row (itself included), not deleted.
export async function membershipsOf(member: { id: string; email: string }) {
  return prisma.member.findMany({
    where: { email: { equals: member.email, mode: "insensitive" }, deletedAt: null },
    select: memberSelect,
  });
}

export type PayerResult =
  | { ok: true; payer: Awaited<ReturnType<typeof membershipsOf>>[number] }
  | { ok: false; status: number; error: string };

// The membership that pays at this borrel for the person behind `memberId`.
export async function resolvePayer(memberId: string, activity: BorrelHost): Promise<PayerResult> {
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, email: true } });
  if (!member) return { ok: false, status: 404, error: "Member not found" };
  const memberships = await membershipsOf(member);
  for (const association of payingAssociations(activity)) {
    const m = memberships.find((x) => x.associationId === association);
    if (m) {
      if (!m.active) return { ok: false, status: 403, error: "Member inactive" };
      return { ok: true, payer: m };
    }
  }
  const self = memberships.find((x) => x.id === memberId) ?? memberships[0];
  const theirs = self ? ASSOCIATION_LABEL[self.associationId as AssociationId] : "another association";
  const host = activity.joint ? "this" : `this ${ASSOCIATION_LABEL[activity.associationId as AssociationId]}`;
  return { ok: false, status: 403, error: `${self?.firstName ?? "This member"} is a ${theirs} member and can't pay at ${host} borrel` };
}

// Same person? (Used for the on-shift bartender's own free drinks.)
export async function samePerson(memberIdA: string | null, emailB: string): Promise<boolean> {
  if (!memberIdA) return false;
  const a = await prisma.member.findUnique({ where: { id: memberIdA }, select: { email: true } });
  return !!a && a.email.toLowerCase() === emailB.toLowerCase();
}

// The membership a card should be stored on when linking it for a person: the
// Stress one if they have it (the snack kiosk is Stress's), else the given one.
// The card then works for every membership of that person.
export async function cardHolderFor(memberId: string): Promise<string | null> {
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, email: true } });
  if (!member) return null;
  const memberships = await membershipsOf(member);
  return (memberships.find((m) => m.associationId === "stress") ?? memberships.find((m) => m.id === memberId))?.id ?? null;
}
