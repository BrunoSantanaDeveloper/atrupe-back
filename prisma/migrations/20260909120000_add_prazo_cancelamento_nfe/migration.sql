-- Teto para tentar o cancelamento da NF-e por evento, em horas, contado da
-- autorizacao de uso. Nulo = teto nacional conhecido (ver
-- src/core/fiscal/utils/prazo-cancelamento.util.ts). Quem valida o prazo real
-- e a SEFAZ da UF do emitente.
ALTER TABLE "invoicy_configs"
  ADD COLUMN IF NOT EXISTS "prazoCancelamentoNfeHoras" INTEGER;
