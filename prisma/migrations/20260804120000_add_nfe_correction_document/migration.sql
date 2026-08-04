-- Cache do DACCE (representação impressa da Carta de Correção).
--
-- O PDF não vem no retorno do envio do evento 110110: é preciso consultar o
-- documento no provedor com ParmEventos=S e ParmPDFBase64=S. Como essa consulta
-- é uma chamada externa paga, o resultado é guardado aqui na primeira vez que
-- alguém baixa a DACCE.
--
-- Fica em tabela própria (e não em nfe_correction_events) porque a listagem de
-- eventos é lida a cada abertura do diálogo e não deve arrastar o binário.

-- CreateTable
CREATE TABLE IF NOT EXISTS "nfe_correction_documents" (
    "correctionEventId" TEXT NOT NULL,
    "pdf" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfe_correction_documents_pkey" PRIMARY KEY ("correctionEventId")
);

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "nfe_correction_documents"
    ADD CONSTRAINT "nfe_correction_documents_correctionEventId_fkey"
    FOREIGN KEY ("correctionEventId") REFERENCES "nfe_correction_events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
