-- AlterTable
ALTER TABLE "PppActivity" ADD COLUMN     "wallstreetActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wallstreetCrashUntil" TIMESTAMP(3),
ADD COLUMN     "wallstreetMaxPct" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "wallstreetMinPct" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "wallstreetProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "wallstreetStartedAt" TIMESTAMP(3),
ADD COLUMN     "wallstreetVolatility" TEXT NOT NULL DEFAULT 'HIGH';

-- CreateTable
CREATE TABLE "PppWallstreetTick" (
    "id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prices" JSONB NOT NULL,
    "crash" BOOLEAN NOT NULL DEFAULT false,
    "activityId" TEXT NOT NULL,

    CONSTRAINT "PppWallstreetTick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PppWallstreetTick_activityId_index_key" ON "PppWallstreetTick"("activityId", "index");

-- AddForeignKey
ALTER TABLE "PppWallstreetTick" ADD CONSTRAINT "PppWallstreetTick_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "PppActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
