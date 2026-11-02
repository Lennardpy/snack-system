-- CreateTable
CREATE TABLE "MonthlyExportRun" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "result" JSONB,
    "emailed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MonthlyExportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyExportRun_period_key" ON "MonthlyExportRun"("period");
