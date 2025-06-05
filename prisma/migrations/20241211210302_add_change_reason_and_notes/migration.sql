-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "changeNotes" TEXT,
ADD COLUMN     "changeReason" TEXT;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "changeNotes" TEXT,
ADD COLUMN     "changeReason" TEXT;
