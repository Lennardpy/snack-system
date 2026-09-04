-- AlterTable
ALTER TABLE "PppInvoiceLine" ADD COLUMN     "bartenderFree" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PppProductCategory" ADD COLUMN     "bartenderFree" BOOLEAN NOT NULL DEFAULT false;
