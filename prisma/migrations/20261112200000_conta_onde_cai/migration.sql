-- A conta onde a operadora de cartão deposita (12/11/2026)
ALTER TABLE "bank_accounts" ADD COLUMN "settlementAccountId" TEXT;
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_settlementAccountId_fkey" FOREIGN KEY ("settlementAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
