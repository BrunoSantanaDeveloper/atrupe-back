/*
  Warnings:

  - You are about to drop the column `downPaymentType` on the `quotation_payments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "quotation_payments" DROP COLUMN "downPaymentType",
ADD COLUMN     "downPaymentConditionId" TEXT,
ADD COLUMN     "downPaymentDueDate" TIMESTAMP(3),
ADD COLUMN     "downPaymentSurcharge" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_downPaymentConditionId_fkey" FOREIGN KEY ("downPaymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
