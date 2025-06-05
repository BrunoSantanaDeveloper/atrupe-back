/*
  Warnings:

  - You are about to drop the `_PolicyToResource` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `resources` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_PolicyToResource" DROP CONSTRAINT "_PolicyToResource_A_fkey";

-- DropForeignKey
ALTER TABLE "_PolicyToResource" DROP CONSTRAINT "_PolicyToResource_B_fkey";

-- DropTable
DROP TABLE "_PolicyToResource";

-- DropTable
DROP TABLE "resources";
