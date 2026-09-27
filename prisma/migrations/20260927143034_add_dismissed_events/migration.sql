-- CreateTable
CREATE TABLE "PppDismissedEvent" (
    "id" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PppDismissedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PppDismissedEvent_matchKey_key" ON "PppDismissedEvent"("matchKey");
