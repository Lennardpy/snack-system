-- Two sites (SSS on snacks.51vo.nl, PPP on ppp.51vo.nl) with separate logins.

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "site" TEXT NOT NULL DEFAULT 'sss';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pppAccess" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sssAccess" BOOLEAN NOT NULL DEFAULT false;


-- Existing admins keep access to both sites and stay unscoped (overall admins);
-- bartenders use the PPP POS. Existing sessions were all made on the snack domain.
UPDATE "User" SET "sssAccess" = true, "pppAccess" = true WHERE "role" = 'ADMIN';
UPDATE "User" SET "pppAccess" = true WHERE "role" = 'BARTENDER';
