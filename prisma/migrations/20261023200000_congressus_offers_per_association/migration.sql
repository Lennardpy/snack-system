-- Phase 4: Dimensie's export — drinks' products in another association's Congressus.

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "congressusPppFolderId" INTEGER;

-- CreateTable
CREATE TABLE "PppProductOffer" (
    "id" TEXT NOT NULL,
    "offerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,

    CONSTRAINT "PppProductOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PppProductOffer_productId_associationId_key" ON "PppProductOffer"("productId", "associationId");

-- AddForeignKey
ALTER TABLE "PppProductOffer" ADD CONSTRAINT "PppProductOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PppProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppProductOffer" ADD CONSTRAINT "PppProductOffer_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

