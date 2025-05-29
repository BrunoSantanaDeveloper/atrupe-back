-- AlterTable
ALTER TABLE "_QuotationToProduct" ADD CONSTRAINT "_QuotationToProduct_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_QuotationToProduct_AB_unique";

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "city" TEXT,
ADD COLUMN     "cnpj" TEXT,
ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "neighborhood" TEXT;
