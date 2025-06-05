/*
  Warnings:

  - You are about to drop the column `clientId` on the `payment_conditions` table. All the data in the column will be lost.
  - Added the required column `paymentMethodId` to the `payment_conditions` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "payment_conditions" DROP CONSTRAINT "payment_conditions_clientId_fkey";

-- AlterTable
ALTER TABLE "payment_conditions" DROP COLUMN "clientId",
ADD COLUMN     "paymentMethodId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "payment_conditions" ADD CONSTRAINT "payment_conditions_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
