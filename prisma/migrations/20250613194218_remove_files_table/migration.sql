/*
  Warnings:

  - You are about to drop the `academy_files` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "academy_files" DROP CONSTRAINT "academy_files_academySystemId_fkey";

-- AlterTable
ALTER TABLE "academy" ADD COLUMN     "files" TEXT[];

-- DropTable
DROP TABLE "academy_files";
