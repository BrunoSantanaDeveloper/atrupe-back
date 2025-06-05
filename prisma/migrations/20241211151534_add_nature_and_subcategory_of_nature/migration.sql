/*
  Warnings:

  - You are about to drop the column `parentId` on the `categories` table. All the data in the column will be lost.
  - You are about to drop the column `categoryId` on the `payables` table. All the data in the column will be lost.
  - You are about to drop the column `categoryId` on the `receivables` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "categories" DROP CONSTRAINT "categories_parentId_fkey";

-- DropForeignKey
ALTER TABLE "payables" DROP CONSTRAINT "payables_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "payables" DROP CONSTRAINT "payables_subCategoryId_fkey";

-- DropForeignKey
ALTER TABLE "receivables" DROP CONSTRAINT "receivables_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "receivables" DROP CONSTRAINT "receivables_subCategoryId_fkey";

-- AlterTable
ALTER TABLE "categories" DROP COLUMN "parentId";

-- AlterTable
ALTER TABLE "payables" DROP COLUMN "categoryId";

-- AlterTable
ALTER TABLE "receivables" DROP COLUMN "categoryId";

-- CreateTable
CREATE TABLE "SubCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "natureId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SubCategory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubCategory" ADD CONSTRAINT "SubCategory_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "Nature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
