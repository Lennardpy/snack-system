import type { Prisma } from "@prisma/client";
import type { AssociationId } from "./associations";

// Association scoping for admin data. A scope is the association a login works
// for, or null for the overall admin (sees everything). Every admin route that
// reads or changes association data filters with these helpers, so a Dimensie
// login never sees Stress data and vice versa. Out-of-scope ids are answered with
// 404 (not 403), so they don't even reveal that the record exists.
export type Scope = AssociationId | null;

export const inScope = (scope: Scope, associationId: string | null | undefined) =>
  scope === null || scope === associationId;

// The associations a scope may act for (e.g. which member syncs it may run).
export const scopeAssociations = (scope: Scope): AssociationId[] => (scope ? [scope] : ["stress", "dimensie"]);

// Things that belong to the Stress side as a whole: the shared drink list (for
// now), external cards, editing the SBZ price list. Dimensie only views SBZ.
export const isStressSide = (scope: Scope) => scope === null || scope === "stress";

export const memberWhere = (scope: Scope): Prisma.MemberWhereInput => (scope ? { associationId: scope } : {});
export const productWhere = (scope: Scope): Prisma.PppProductWhereInput => (scope ? { associationId: scope } : {});
export const categoryWhere = (scope: Scope): Prisma.PppProductCategoryWhereInput => (scope ? { associationId: scope } : {});
export const roleWhere = (scope: Scope): Prisma.MemberRoleWhereInput => (scope ? { associationId: scope } : {});
// Borrels an association HOSTS (runs, pays for, owns the P/L of).
export const activityWhere = (scope: Scope): Prisma.PppActivityWhereInput => (scope ? { associationId: scope } : {});
// Borrels an association can SEE: its own, plus — for Dimensie — the joint borrels
// Stress hosts (Dimensie bartenders work there; the Dimensie admin views them
// read-only).
export const activityVisibleWhere = (scope: Scope): Prisma.PppActivityWhereInput =>
  scope === null ? {} : scope === "stress" ? { associationId: "stress" } : { OR: [{ associationId: scope }, { joint: true }] };
// Bartender accounts of the association (the overall admin sees all).
export const userWhere = (scope: Scope): Prisma.UserWhereInput => (scope ? { associationId: scope } : {});

// A bar order is visible to an association when it was at one of its borrels or
// placed by one of its members (Dimensie members drinking at a joint borrel).
export const pppInvoiceWhere = (scope: Scope): Prisma.PppInvoiceWhereInput =>
  scope ? { OR: [{ activity: { associationId: scope } }, { member: { associationId: scope } }] } : {};

// The scope of POS staff (bartenders, and admins using the POS): the association
// their account works for, or null (an unscoped admin) for every borrel.
export const posScope = (user: { associationId: string | null }): Scope => (user.associationId as AssociationId | null) ?? null;
