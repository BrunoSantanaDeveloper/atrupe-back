/*
  Warnings:

  - The values [SUSPENDED] on the enum `ClientStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ClientStatus_new" AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE');
ALTER TABLE "clients" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "suppliers" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "clients" ALTER COLUMN "status" TYPE "ClientStatus_new" USING ("status"::text::"ClientStatus_new");
ALTER TABLE "suppliers" ALTER COLUMN "status" TYPE "ClientStatus_new" USING ("status"::text::"ClientStatus_new");
ALTER TYPE "ClientStatus" RENAME TO "ClientStatus_old";
ALTER TYPE "ClientStatus_new" RENAME TO "ClientStatus";
DROP TYPE "ClientStatus_old";
ALTER TABLE "clients" ALTER COLUMN "status" SET DEFAULT 'PROSPECT';
ALTER TABLE "suppliers" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;
