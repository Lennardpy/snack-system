-- AlterTable
ALTER TABLE "PppInvoice" ADD COLUMN     "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "PppInvoice" ADD CONSTRAINT "PppInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
