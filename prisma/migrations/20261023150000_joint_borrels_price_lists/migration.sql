-- Joint borrels (Stress + Dimensie), a drink list per association, and price/VAT
-- snapshots on order lines.

-- DropIndex
DROP INDEX "PppProductCategory_name_key";

-- AlterTable
ALTER TABLE "PppActivity" ADD COLUMN     "joint" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PppInvoiceLine" ADD COLUMN     "baseCents" INTEGER,
ADD COLUMN     "vatRate" INTEGER;

-- AlterTable
ALTER TABLE "PppProduct" ADD COLUMN     "associationId" TEXT NOT NULL DEFAULT 'stress';

-- AlterTable
ALTER TABLE "PppProductCategory" ADD COLUMN     "associationId" TEXT NOT NULL DEFAULT 'stress';

-- CreateIndex
CREATE UNIQUE INDEX "PppProductCategory_associationId_name_key" ON "PppProductCategory"("associationId", "name");

-- AddForeignKey
ALTER TABLE "PppProductCategory" ADD CONSTRAINT "PppProductCategory_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppProduct" ADD CONSTRAINT "PppProduct_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The weekly joint drink is the Thursday "Weekly Drink" organised by Stress (same
-- rule as the Alexia import, src/lib/alexia.ts): mark the existing ones joint.
-- (Past ones change nothing — no Dimensie member has ordered yet.)
UPDATE "PppActivity" SET "joint" = true
WHERE "associationId" = 'stress'
  AND "name" ILIKE '%weekly%'
  AND EXTRACT(ISODOW FROM ((COALESCE("startsAt", "date") AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Amsterdam')) = 4;
