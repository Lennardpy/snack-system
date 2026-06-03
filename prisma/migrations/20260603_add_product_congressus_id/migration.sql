-- AlterTable: add congressusProductId to Product
ALTER TABLE "Product" ADD COLUMN "congressusProductId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Product_congressusProductId_key" ON "Product"("congressusProductId");
