-- Optional spending limit per borrel on external cards.

-- AlterTable
ALTER TABLE "ExternalCard" ADD COLUMN     "limitCents" INTEGER;

