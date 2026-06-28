-- AlterTable
ALTER TABLE "PppActivity" ADD COLUMN     "discountsActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PppActivityDiscount" (
    "id" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activityId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "PppActivityDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PppActivityDiscount_activityId_productId_key" ON "PppActivityDiscount"("activityId", "productId");

-- AddForeignKey
ALTER TABLE "PppActivityDiscount" ADD CONSTRAINT "PppActivityDiscount_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "PppActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppActivityDiscount" ADD CONSTRAINT "PppActivityDiscount_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PppProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
