ALTER TABLE "nfces"
ADD COLUMN "cpfConsumidor" TEXT,
ADD COLUMN "consumidorNome" TEXT,
ADD COLUMN "informacoesComplementares" TEXT,
ADD COLUMN "itensSnapshot" JSONB,
ADD COLUMN "pagamentosSnapshot" JSONB;
