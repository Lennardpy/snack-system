ALTER TABLE "Product" ADD COLUMN "congressusProductOfferId" INTEGER;
CREATE UNIQUE INDEX "Product_congressusProductOfferId_key" ON "Product"("congressusProductOfferId");
