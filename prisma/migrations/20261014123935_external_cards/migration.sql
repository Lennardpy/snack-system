-- CreateEnum
CREATE TYPE "ExternalPriceLevel" AS ENUM ('INTERNAL', 'INTERNAL_PLUS_10', 'TUSSEN', 'EXTERNAL');

-- CreateTable
CREATE TABLE "ExternalCard" (
    "id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PppExternalTab" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "priceLevel" "ExternalPriceLevel" NOT NULL DEFAULT 'EXTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activityId" TEXT NOT NULL,
    "cardId" TEXT,
    "cardName" TEXT NOT NULL,

    CONSTRAINT "PppExternalTab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PppExternalOrder" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tabId" TEXT NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "PppExternalOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PppExternalLine" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCents" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "PppExternalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCard_uid_key" ON "ExternalCard"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "PppExternalTab_activityId_cardId_key" ON "PppExternalTab"("activityId", "cardId");

-- AddForeignKey
ALTER TABLE "PppExternalTab" ADD CONSTRAINT "PppExternalTab_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "PppActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppExternalTab" ADD CONSTRAINT "PppExternalTab_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "ExternalCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppExternalOrder" ADD CONSTRAINT "PppExternalOrder_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "PppExternalTab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppExternalOrder" ADD CONSTRAINT "PppExternalOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppExternalLine" ADD CONSTRAINT "PppExternalLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PppExternalOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppExternalLine" ADD CONSTRAINT "PppExternalLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PppProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
