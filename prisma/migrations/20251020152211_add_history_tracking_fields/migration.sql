-- DropForeignKey
ALTER TABLE "payable_history" DROP CONSTRAINT "payable_history_payableId_fkey";

-- DropForeignKey
ALTER TABLE "receivable_history" DROP CONSTRAINT "receivable_history_receivableId_fkey";

-- AlterTable
ALTER TABLE "payable_history" ADD COLUMN     "changes" JSONB,
ADD COLUMN     "createdByName" TEXT,
ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "receivable_history" ADD COLUMN     "changes" JSONB,
ADD COLUMN     "createdByName" TEXT,
ADD COLUMN     "metadata" JSONB;

-- CreateIndex
CREATE INDEX "payable_history_payableId_idx" ON "payable_history"("payableId");

-- CreateIndex
CREATE INDEX "payable_history_createdAt_idx" ON "payable_history"("createdAt");

-- CreateIndex
CREATE INDEX "payable_history_createdBy_idx" ON "payable_history"("createdBy");

-- CreateIndex
CREATE INDEX "receivable_history_receivableId_idx" ON "receivable_history"("receivableId");

-- CreateIndex
CREATE INDEX "receivable_history_createdAt_idx" ON "receivable_history"("createdAt");

-- CreateIndex
CREATE INDEX "receivable_history_createdBy_idx" ON "receivable_history"("createdBy");

-- AddForeignKey
ALTER TABLE "receivable_history" ADD CONSTRAINT "receivable_history_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_history" ADD CONSTRAINT "receivable_history_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_history" ADD CONSTRAINT "payable_history_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_history" ADD CONSTRAINT "payable_history_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
