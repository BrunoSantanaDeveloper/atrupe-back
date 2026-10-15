-- Caixa do dia (Fase 7.1/7.2, módulo 5, LITE): a conta ganha tipo, contagem às
-- cegas, tolerância da quebra e saldo inicial; a regra por forma ganha a
-- conta padrão; o caixa ganha número, quem abriu e fechou, o informado e as
-- reaberturas; o lançamento ganha conta, tipo especial, retroativo,
-- aprovação, responsável, plano de contas e par. Valores em reais, como o
-- resto destas tabelas (a API nova responde em centavos).


-- CreateEnum
CREATE TYPE "BankAccountKind" AS ENUM ('CASH', 'BANK', 'CARD');

-- CreateEnum
CREATE TYPE "CashMovementKind" AS ENUM ('ADJUSTMENT', 'SHORTAGE', 'OVERAGE', 'REVERSAL');
ALTER TABLE "bank_account_cash_controls" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bank_accounts" ADD COLUMN     "blindCount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" "BankAccountKind" NOT NULL DEFAULT 'BANK',
ADD COLUMN     "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "openingDate" DATE,
ADD COLUMN     "shortageTolerance" DOUBLE PRECISION;
ALTER TABLE "cash_registers" ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "closedByName" TEXT,
ADD COLUMN     "informed" DOUBLE PRECISION,
ADD COLUMN     "number" INTEGER,
ADD COLUMN     "openedById" TEXT,
ADD COLUMN     "openedByName" TEXT,
ADD COLUMN     "reopenings" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "transactions" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedByName" TEXT,
ADD COLUMN     "awaitingApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "kind" "CashMovementKind",
ADD COLUMN     "linkedId" TEXT,
ADD COLUMN     "natureId" TEXT,
ADD COLUMN     "operationDate" TIMESTAMP(3),
ADD COLUMN     "paymentConditionId" TEXT,
ADD COLUMN     "responsibleId" TEXT,
ADD COLUMN     "responsibleName" TEXT,
ADD COLUMN     "retroactive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subCategoryId" TEXT,
ALTER COLUMN "cashRegisterId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "transactions_bankAccountId_transactionDate_idx" ON "transactions"("bankAccountId", "transactionDate");

-- CreateIndex
CREATE INDEX "transactions_linkedId_idx" ON "transactions"("linkedId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A conta do banco "000" (a "Caixa Empresa" semeada) é o caixa físico
UPDATE "bank_accounts" SET "kind" = 'CASH'
WHERE "bankId" IN (SELECT "id" FROM "banks" WHERE "code" = '000');

-- O lançamento antigo leva a conta do caixa em que está
UPDATE "transactions" t SET "bankAccountId" = c."bankAccountId"
FROM "cash_registers" c WHERE t."cashRegisterId" = c."id";

-- O número sequencial dos caixas por empresa, pela data de abertura
UPDATE "cash_registers" c SET "number" = r.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "companyId" ORDER BY "openingDate", "createdAt") AS rn
  FROM "cash_registers"
) r
WHERE c."id" = r."id";
