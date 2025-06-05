/*
  Warnings:

  - You are about to drop the `policies` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `role_policies` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "role_policies" DROP CONSTRAINT "role_policies_policyId_fkey";

-- DropForeignKey
ALTER TABLE "role_policies" DROP CONSTRAINT "role_policies_roleId_fkey";

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "permissions" TEXT[];

-- DropTable
DROP TABLE "policies";

-- DropTable
DROP TABLE "role_policies";
