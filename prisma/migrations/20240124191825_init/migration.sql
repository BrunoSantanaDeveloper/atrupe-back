/*
  Warnings:

  - You are about to drop the column `contactName` on the `suppliers` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `suppliers` table. All the data in the column will be lost.
  - Added the required column `companyId` to the `suppliers` table without a default value. This is not possible if the table is not empty.
  - Added the required column `details` to the `suppliers` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "CategoryKind" ADD VALUE 'SUPPLIER';

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "suppliers" DROP COLUMN "contactName",
DROP COLUMN "phone",
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "companyId" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "details" JSONB NOT NULL,
ADD COLUMN     "kind" "ClientKind" NOT NULL DEFAULT 'PERSON',
ADD COLUMN     "mobilePhone" TEXT,
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
