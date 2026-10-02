-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'EXPORTING';

-- AlterTable
ALTER TABLE "PppInvoice" ADD COLUMN     "exportClaim" TEXT,
ADD COLUMN     "exportClaimedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SaleInvoice" ADD COLUMN     "exportClaim" TEXT,
ADD COLUMN     "exportClaimedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'password';

-- Existing sessions can't be told apart (all default to 'password', 7 days), and
-- bartender card logins from the last borrel would otherwise expire mid-way through
-- the next one. End all bartender sessions once: they tap their card again at the
-- start of the next borrel. Admin sessions are kept.
DELETE FROM "Session" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "role" = 'BARTENDER');
