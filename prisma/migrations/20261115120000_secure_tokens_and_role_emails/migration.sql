-- One ADMIN and one BARTENDER account may share an email: unique per role.
DROP INDEX "User_email_key";
CREATE UNIQUE INDEX "User_email_role_key" ON "User"("email", "role");

-- Tokens used to come from Prisma's cuid() (Math.random based, not secure).
-- Replace every existing one with a random value so none of them works any more:
-- staff logins and kiosk carts end, unused invite / card-link emails stop working
-- (resend them). gen_random_uuid() is cryptographically random (Postgres 13+).
UPDATE "Session"
SET "token" = 'revoked-' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    "expiresAt" = now();
UPDATE "ShopSession"
SET "token" = 'revoked-' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    "expiresAt" = now();
UPDATE "PasswordSetupToken"
SET "token" = 'revoked-' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
UPDATE "CardRegistration"
SET "token" = 'revoked-' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    "expiresAt" = LEAST("expiresAt", now());
