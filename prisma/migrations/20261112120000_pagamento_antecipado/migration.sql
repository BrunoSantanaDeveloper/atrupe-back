-- Pagamento antecipado (PA, 12/11/2026): a venda aprovada fica pendente até
-- o pagamento entrar; o título que a libera leva a marcação "⚠️ Pendência"
ALTER TYPE "QuotationStatus" ADD VALUE 'PENDING_PAYMENT';

CREATE TYPE "QuotationHoldReason" AS ENUM ('PREPAYMENT', 'CREDIT_LIMIT');

ALTER TABLE "clients" ADD COLUMN "requirePrepayment" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "quotations"
  ADD COLUMN "holdReason" "QuotationHoldReason",
  ADD COLUMN "holdAmount" INTEGER,
  ADD COLUMN "holdAt" TIMESTAMP(3),
  ADD COLUMN "holdReleasedAt" TIMESTAMP(3),
  ADD COLUMN "holdReleaseNote" TEXT,
  ADD COLUMN "holdReleasedBy" TEXT;

ALTER TABLE "receivables" ADD COLUMN "releasesQuotation" BOOLEAN NOT NULL DEFAULT false;
