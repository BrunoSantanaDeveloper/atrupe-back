-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "isImported" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "isImported" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "isImported" BOOLEAN NOT NULL DEFAULT false;
