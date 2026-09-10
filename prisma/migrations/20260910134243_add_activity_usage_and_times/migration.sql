-- AlterTable
ALTER TABLE "PppActivity" ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "startsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PppActivityUsage" (
    "id" TEXT NOT NULL,
    "sbzKey" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activityId" TEXT NOT NULL,

    CONSTRAINT "PppActivityUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PppActivityUsage_activityId_sbzKey_key" ON "PppActivityUsage"("activityId", "sbzKey");

-- AddForeignKey
ALTER TABLE "PppActivityUsage" ADD CONSTRAINT "PppActivityUsage_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "PppActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
