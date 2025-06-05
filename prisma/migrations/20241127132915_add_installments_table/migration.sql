/*
  Warnings:

  - You are about to drop the column `installments` on the `payment_conditions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "payment_conditions" DROP COLUMN "installments",
ADD COLUMN     "dayInterval" INTEGER,
ADD COLUMN     "receivingType" TEXT,
ALTER COLUMN "acceptInstallments" SET DEFAULT false;

-- CreateTable
CREATE TABLE "installments" (
    "id" TEXT NOT NULL,
    "installment" INTEGER NOT NULL,
    "operatorFeeRate" DOUBLE PRECISION NOT NULL,
    "operatorFeeTransfer" DOUBLE PRECISION NOT NULL,
    "paymentConditionId" TEXT NOT NULL,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
