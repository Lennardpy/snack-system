-- Specifications to Dimensie are created per Dimensie export (not per month):
-- a free-text period instead of one unique month.
DROP INDEX "AssociationSettlement_debtorId_month_key";
ALTER TABLE "AssociationSettlement" RENAME COLUMN "month" TO "period";
