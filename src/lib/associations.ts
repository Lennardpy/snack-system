// The associations using the system. Ids match the Association table rows (created
// by migrations). Safe to import from client components.
export type AssociationId = "stress" | "dimensie";
export const ASSOCIATION_IDS: AssociationId[] = ["stress", "dimensie"];
export const ASSOCIATION_LABEL: Record<AssociationId, string> = { stress: "Stress", dimensie: "Dimensie" };

export const isAssociationId = (v: unknown): v is AssociationId =>
  typeof v === "string" && (ASSOCIATION_IDS as string[]).includes(v);
