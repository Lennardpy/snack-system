-- Multi-association: SV Dimensie joins PPP. Member ids/emails/role names become
-- unique per association instead of globally.

-- DropIndex
DROP INDEX "Member_congressusId_key";

-- DropIndex
DROP INDEX "Member_email_key";

-- DropIndex
DROP INDEX "MemberRole_name_key";

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "associationId" TEXT NOT NULL DEFAULT 'stress';

-- AlterTable
ALTER TABLE "MemberRole" ADD COLUMN     "associationId" TEXT NOT NULL DEFAULT 'stress';

-- AlterTable
ALTER TABLE "PppActivity" ADD COLUMN     "associationId" TEXT NOT NULL DEFAULT 'stress';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "associationId" TEXT;

-- CreateTable
CREATE TABLE "Association" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Association_pkey" PRIMARY KEY ("id")
);

-- The two associations. Everything that already exists belongs to Stress (the
-- column defaults above); bartender accounts work for Stress, admins stay
-- unscoped (null = sees every association).
INSERT INTO "Association" ("id", "name") VALUES ('stress', 'Stress'), ('dimensie', 'SV Dimensie');
UPDATE "User" SET "associationId" = 'stress' WHERE "role" = 'BARTENDER';

-- CreateIndex
CREATE UNIQUE INDEX "Member_associationId_congressusId_key" ON "Member"("associationId", "congressusId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_associationId_email_key" ON "Member"("associationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "MemberRole_associationId_name_key" ON "MemberRole"("associationId", "name");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberRole" ADD CONSTRAINT "MemberRole_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PppActivity" ADD CONSTRAINT "PppActivity_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

