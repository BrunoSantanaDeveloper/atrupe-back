/*
  Warnings:

  - Added the required column `clientId` to the `payment_conditions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "payment_conditions" ADD COLUMN     "clientId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "payment_conditions" ADD CONSTRAINT "payment_conditions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
