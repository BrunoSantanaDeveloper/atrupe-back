-- Dados de pagamento do fornecedor (26/10/2026)
ALTER TABLE "suppliers" ADD COLUMN "pixKey" TEXT,
ADD COLUMN "bankName" TEXT,
ADD COLUMN "bankAgency" TEXT,
ADD COLUMN "bankAccount" TEXT,
ADD COLUMN "accountHolder" TEXT,
ADD COLUMN "paymentTerms" TEXT;
