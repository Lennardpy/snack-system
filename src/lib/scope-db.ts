import { prisma } from "./prisma";
import { inScope, type Scope } from "./scope";

// Record-level scope checks for admin routes that take an id (see scope.ts).
// false → answer 404, as if the record didn't exist.

export async function activityInScope(id: string, scope: Scope): Promise<boolean> {
  if (scope === null) return true;
  const a = await prisma.pppActivity.findUnique({ where: { id }, select: { associationId: true } });
  return !!a && inScope(scope, a.associationId);
}
