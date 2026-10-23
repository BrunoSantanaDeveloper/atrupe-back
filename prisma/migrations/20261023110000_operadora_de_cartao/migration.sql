-- Conta da operadora de cartão (revisão de 23/10/2026): a conta CARD não
-- escolhe banco. Ela fica no banco genérico "Operadora de cartão" (código
-- CARD, como o 000 da gaveta) e guarda o nome da operadora (Rede, Cielo,
-- Stone...) em bank_accounts.operator. As contas que já existem ficam como
-- estão.

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "operator" TEXT;

-- O banco genérico, uma vez só (idempotente)
INSERT INTO "banks" ("id", "name", "code", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Operadora de cartão', 'CARD', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "banks" WHERE "code" = 'CARD');
