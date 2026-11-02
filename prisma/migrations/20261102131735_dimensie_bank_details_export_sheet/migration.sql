-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "bicEnc" TEXT,
ADD COLUMN     "ibanEnc" TEXT,
ADD COLUMN     "studentNumber" TEXT;

-- AlterTable
ALTER TABLE "PppInvoice" ADD COLUMN     "exportBatchId" TEXT;

-- CreateTable
CREATE TABLE "PppExportBatch" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "members" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PppExportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PppExportBatch_number_key" ON "PppExportBatch"("number");

-- AddForeignKey
ALTER TABLE "PppInvoice" ADD CONSTRAINT "PppInvoice_exportBatchId_fkey" FOREIGN KEY ("exportBatchId") REFERENCES "PppExportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppExportBatch" ADD CONSTRAINT "PppExportBatch_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
