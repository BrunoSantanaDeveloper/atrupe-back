-- AlterTable
ALTER TABLE "nfces" ADD COLUMN     "protocoloCancelamento" TEXT;

-- AlterTable
ALTER TABLE "nfes" ADD COLUMN     "protocoloCancelamento" TEXT,
ADD COLUMN     "protocoloCorrecao" TEXT,
ADD COLUMN     "sequenciaCorrecao" INTEGER;
