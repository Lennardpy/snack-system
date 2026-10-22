import { prisma } from "./prisma";
import { congressusConfig, createPppCongressusProduct, createProductFolder } from "./congressus";
import type { AssociationId } from "./associations";

// The Congressus product offer to invoice each PPP drink under, in the exporting
// association's Congressus:
//   • Stress — the drink's own offer (PppProduct.congressusProductOfferId), as before;
//     without one the line falls back to the "SSS purchases Mendix" product.
//   • Dimensie — a product in DIMENSIE's Congressus (PppProductOffer), for its own
//     drinks and for Stress drinks its members had at joint borrels. Missing ones are
//     created in its "PPP" folder (made on the first export) without VAT — Dimensie
//     doesn't do VAT, and the API can't set it anyway.
// Throws if Congressus refuses; the export then releases every claimed order.
export async function pppOffersFor(association: AssociationId, productIds: string[]): Promise<Map<string, number | null>> {
  const ids = [...new Set(productIds)];
  const out = new Map<string, number | null>();
  if (ids.length === 0) return out;

  if (association === "stress") {
    const products = await prisma.pppProduct.findMany({
      where: { id: { in: ids } },
      select: { id: true, congressusProductOfferId: true },
    });
    for (const p of products) out.set(p.id, p.congressusProductOfferId ?? null);
    return out;
  }

  const existing = await prisma.pppProductOffer.findMany({
    where: { associationId: association, productId: { in: ids } },
    select: { productId: true, offerId: true },
  });
  for (const o of existing) out.set(o.productId, o.offerId);
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length === 0) return out;

  const folderId = await pppFolderFor(association);
  const products = await prisma.pppProduct.findMany({
    where: { id: { in: missing } },
    select: { id: true, name: true, price: true },
  });
  // One at a time: the new offer id is looked up in the folder by name.
  for (const p of products) {
    const { offerId } = await createPppCongressusProduct(association, p.name, p.price / 100, "ZERO", folderId);
    if (offerId == null) throw new Error(`Could not create "${p.name}" in ${association}'s Congressus`);
    await prisma.pppProductOffer.create({ data: { productId: p.id, associationId: association, offerId } });
    out.set(p.id, offerId);
  }
  return out;
}

// The association's PPP product folder: configured, saved earlier, or created now.
async function pppFolderFor(association: AssociationId): Promise<number> {
  const configured = congressusConfig(association).pppFolderId;
  if (configured != null) return configured;
  const a = await prisma.association.findUniqueOrThrow({ where: { id: association }, select: { congressusPppFolderId: true } });
  if (a.congressusPppFolderId != null) return a.congressusPppFolderId;
  const folderId = await createProductFolder(association, "PPP");
  await prisma.association.update({ where: { id: association }, data: { congressusPppFolderId: folderId } });
  return folderId;
}
