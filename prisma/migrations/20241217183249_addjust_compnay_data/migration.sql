/*
  Warnings:

  - You are about to drop the column `phoneNumber` on the `companies` table. All the data in the column will be lost.
  - You are about to drop the column `website` on the `companies` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "companies" DROP COLUMN "phoneNumber",
DROP COLUMN "website",
ADD COLUMN     "email" TEXT,
ADD COLUMN     "favIconUrl" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "siteUrl" TEXT,
ADD COLUMN     "textAfterItems" TEXT,
ADD COLUMN     "textBeforeItems" TEXT;
