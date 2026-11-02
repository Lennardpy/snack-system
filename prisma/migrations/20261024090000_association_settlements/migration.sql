-- Phase 5: Stress's monthly invoice to Dimensie.

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('FINAL', 'SENT');

-- AlterTable
ALTER TABLE "PppInvoice" ADD COLUMN     "settlementId" TEXT;

-- CreateTable
CREATE TABLE "AssociationSettlement" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL DEFAULT 'stress',
    "status" "SettlementStatus" NOT NULL DEFAULT 'FINAL',
    "totalExclCents" INTEGER NOT NULL,
    "totalVatCents" INTEGER NOT NULL,
    "totalInclCents" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "AssociationSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssociationSettlement_number_key" ON "AssociationSettlement"("number");

-- CreateIndex
CREATE UNIQUE INDEX "AssociationSettlement_debtorId_month_key" ON "AssociationSettlement"("debtorId", "month");

-- AddForeignKey
ALTER TABLE "PppInvoice" ADD CONSTRAINT "PppInvoice_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "AssociationSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

