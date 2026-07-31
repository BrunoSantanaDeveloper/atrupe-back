-- Ciclo de vida do evento de Carta de Correção (CC-e / 110110).
--
-- Antes desta migration a linha em nfe_correction_events só era criada DEPOIS da
-- confirmação da SEFAZ, e a chamada HTTP acontecia dentro da transação. Quando a
-- transação estourava (30s) com o evento já registrado no fisco, o rollback
-- apagava a reserva e a mesma sequência era reenviada, resultando em rejeição por
-- duplicidade (cStat 573) e travando a NF-e.
--
-- Agora a sequência é reservada em estado PENDING antes do POST e confirmada
-- (REGISTERED) ou marcada como REJECTED depois, fora da transação.

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "NfeCorrectionStatus" AS ENUM ('PENDING', 'REGISTERED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- AlterTable
ALTER TABLE "nfe_correction_events"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "status" "NfeCorrectionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "ambiente" INTEGER,
  ADD COLUMN IF NOT EXISTS "sitCodigo" INTEGER,
  ADD COLUMN IF NOT EXISTS "codigoRetorno" INTEGER,
  ADD COLUMN IF NOT EXISTS "motivoRejeicao" TEXT,
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT,
  ADD COLUMN IF NOT EXISTS "createdByName" TEXT;

-- Backfill: toda linha que existia antes desta migration só era gravada após
-- SitCodigo 135, portanto é um evento efetivamente registrado.
UPDATE "nfe_correction_events"
SET "status" = 'REGISTERED'
WHERE "status" = 'PENDING';

UPDATE "nfe_correction_events"
SET "sitCodigo" = 135
WHERE "sitCodigo" IS NULL AND "status" = 'REGISTERED';

UPDATE "nfe_correction_events"
SET "updatedAt" = COALESCE("dataEvento", "createdAt")
WHERE "updatedAt" IS NULL;

ALTER TABLE "nfe_correction_events"
  ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "nfe_correction_events_nfeId_status_idx"
  ON "nfe_correction_events"("nfeId", "status");
