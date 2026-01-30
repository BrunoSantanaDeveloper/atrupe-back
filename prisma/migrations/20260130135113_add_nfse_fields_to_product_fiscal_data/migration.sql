-- AlterTable
ALTER TABLE "product_fiscal_data" ADD COLUMN     "cnae" TEXT,
ADD COLUMN     "codClassificacao" TEXT DEFAULT '000001',
ADD COLUMN     "codTribMunicipio" TEXT,
ADD COLUMN     "codTribNacional" TEXT,
ADD COLUMN     "nbs" TEXT;
