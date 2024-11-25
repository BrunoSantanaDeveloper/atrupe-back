/*
  Warnings:

  - You are about to drop the column `name` on the `quotations` table. All the data in the column will be lost.
  - Made the column `totalValue` on table `quotations` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "quotations" DROP COLUMN "name",
ADD COLUMN     "contactType" TEXT,
ADD COLUMN     "tagId" TEXT,
ALTER COLUMN "totalValue" SET NOT NULL,
ALTER COLUMN "totalValue" SET DEFAULT 0;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "status_quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
