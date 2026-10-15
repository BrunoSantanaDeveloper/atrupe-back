-- Conciliação com o extrato (CX-6): as linhas do OFX importado, casadas,
-- sugeridas ou sobrando. Centavos, com sinal.

-- CreateEnum
CREATE TYPE "StatementLineStatus" AS ENUM ('MATCHED', 'SUGGESTED', 'UNMATCHED', 'CREATED', 'IGNORED');

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "fitId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',
    "status" "StatementLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "transactionId" TEXT,
    "receivableInstallmentId" TEXT,
    "payableInstallmentId" TEXT,
    "importId" TEXT NOT NULL,
    "fileName" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedByName" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedByName" TEXT,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_statement_lines_companyId_bankAccountId_status_idx" ON "bank_statement_lines"("companyId", "bankAccountId", "status");

-- CreateIndex
CREATE INDEX "bank_statement_lines_transactionId_idx" ON "bank_statement_lines"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_bankAccountId_fitId_key" ON "bank_statement_lines"("bankAccountId", "fitId");

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
