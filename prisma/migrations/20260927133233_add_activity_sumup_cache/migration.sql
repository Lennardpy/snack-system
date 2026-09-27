-- CreateTable
CREATE TABLE "PppActivitySumup" (
    "id" TEXT NOT NULL,
    "revenueCents" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "byDrink" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activityId" TEXT NOT NULL,

    CONSTRAINT "PppActivitySumup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PppActivitySumup_activityId_key" ON "PppActivitySumup"("activityId");

-- AddForeignKey
ALTER TABLE "PppActivitySumup" ADD CONSTRAINT "PppActivitySumup_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "PppActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
