import { prisma } from "./prisma";
import type { Scope } from "./scope";

// Record-level scope checks for routes that take an id (see scope.ts).
// null / false → answer 404, as if the record didn't exist.

// How an association may use a borrel: "full" = it hosts it (or the overall
// admin); "read" = Dimensie at a joint borrel Stress hosts — Dimensie bartenders
// charge there, the Dimensie admin only views it (no edits, SBZ usage, specials…).
export async function activityAccess(id: string, scope: Scope): Promise<"full" | "read" | null> {
  const a = await prisma.pppActivity.findUnique({ where: { id }, select: { associationId: true, joint: true } });
  if (!a) return null;
  if (scope === null || a.associationId === scope) return "full";
  if (scope === "dimensie" && a.joint) return "read";
  return null;
}

// The association hosts this borrel (may change it).
export async function activityInScope(id: string, scope: Scope): Promise<boolean> {
  return (await activityAccess(id, scope)) === "full";
}

// The association can see / work at this borrel (hosts it, or it's joint).
export async function activityVisible(id: string, scope: Scope): Promise<boolean> {
  return (await activityAccess(id, scope)) !== null;
}
