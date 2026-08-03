-- Fase 1 da centralizacao fiscal: rastreabilidade do emissor.
--
-- Antes desta migration, apenas `nfces` guardava qual emissor gerou o
-- documento. NF-e e NFS-e nao tinham nem FK de emissor nem snapshot do
-- payload, entao operacoes posteriores (devolucao, carta de correcao)
-- re-derivavam CFOP e natureza da operacao a partir da configuracao ATUAL,
-- que pode ter mudado desde a emissao.
--
-- Tambem troca SetNull por Restrict em `nfces`: excluir um emissor nao pode
-- apagar a atribuicao de documentos ja autorizados.
--
-- Migration puramente aditiva. Documentos historicos ficam com
-- invoicyConfigId NULL — nao ha heuristica confiavel de backfill (a serie
-- colide entre emissores e a data nao identifica ninguem), entao a UI deve
-- rotular esses casos como "emissor nao registrado".

-- DropForeignKey
ALTER TABLE "nfces" DROP CONSTRAINT "nfces_invoicyConfigId_fkey";

-- AlterTable
ALTER TABLE "nfes" ADD COLUMN     "invoicyConfigId" TEXT,
ADD COLUMN     "invoicyPayloadEnvio" JSONB;

-- AlterTable
ALTER TABLE "nfses" ADD COLUMN     "invoicyConfigId" TEXT,
ADD COLUMN     "invoicyPayloadEnvio" JSONB;

-- CreateIndex
CREATE INDEX "nfes_invoicyConfigId_idx" ON "nfes"("invoicyConfigId");

-- CreateIndex
CREATE INDEX "nfses_invoicyConfigId_idx" ON "nfses"("invoicyConfigId");

-- AddForeignKey
ALTER TABLE "nfes" ADD CONSTRAINT "nfes_invoicyConfigId_fkey" FOREIGN KEY ("invoicyConfigId") REFERENCES "invoicy_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfses" ADD CONSTRAINT "nfses_invoicyConfigId_fkey" FOREIGN KEY ("invoicyConfigId") REFERENCES "invoicy_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfces" ADD CONSTRAINT "nfces_invoicyConfigId_fkey" FOREIGN KEY ("invoicyConfigId") REFERENCES "invoicy_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
