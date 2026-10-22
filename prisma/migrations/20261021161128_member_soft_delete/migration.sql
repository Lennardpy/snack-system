-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "congressusId" DROP NOT NULL;
