-- AlterTable
ALTER TABLE "MemberRole" ADD COLUMN     "ownDrinkOnly" BOOLEAN NOT NULL DEFAULT false;

-- PilsCie's discount is for their own drink only (one per order).
UPDATE "MemberRole" SET "ownDrinkOnly" = true WHERE "name" = 'PilsCie';
