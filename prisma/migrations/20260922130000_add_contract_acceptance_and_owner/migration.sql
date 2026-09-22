-- Aceite do contrato por contratação e titular da conta.
--
-- Aditivo e reexecutável (IF NOT EXISTS / blocos DO), para poder ser
-- aplicado à mão antes do deploy sem conflitar com o migrate deploy depois.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ContractorType" AS ENUM ('PF', 'PJ');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;

-- CreateTable
-- Registro jurídico do aceite: sem chave para usuário nem empresa, de
-- propósito — excluir um usuário ou uma conta não pode apagá-lo nem ser
-- bloqueado por ele.
CREATE TABLE IF NOT EXISTS "contract_acceptances" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contractId" TEXT NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "context" TEXT NOT NULL,
    "acceptedByUserId" TEXT NOT NULL,
    "acceptedByName" TEXT NOT NULL,
    "acceptedByEmail" TEXT NOT NULL,
    "contractorType" "ContractorType" NOT NULL,
    "contractorDocument" TEXT NOT NULL,
    "contractorName" TEXT NOT NULL,
    "contractorTradeName" TEXT,
    "contractorEmail" TEXT NOT NULL,
    "representativeCpf" TEXT,
    "representativeName" TEXT,
    "representativeVerified" BOOLEAN,
    "representativeIsSessionUser" BOOLEAN NOT NULL DEFAULT false,
    "registrySnapshot" JSONB,
    "termsSha256" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "contract_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contract_acceptances_companyId_createdAt_idx" ON "contract_acceptances"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contract_acceptances_subscriptionId_idx" ON "contract_acceptances"("subscriptionId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill do titular (só empresas principais; filiais seguem a principal).
-- O titular é quem criou a conta. No cadastro, o usuário que se cadastra é
-- ligado ao customer da empresa; quando houver mais de um, vale o mais antigo.
UPDATE "companies" AS c
SET "ownerUserId" = o."userId"
FROM (
  SELECT DISTINCT ON (cu."company_id") cu."company_id" AS "companyId", u."id" AS "userId"
  FROM "users" AS u
  JOIN "customers" AS cu ON cu."id" = u."customerId"
  WHERE cu."company_id" IS NOT NULL
  ORDER BY cu."company_id", u."createdAt" ASC
) AS o
WHERE o."companyId" = c."id"
  AND c."ownerUserId" IS NULL
  AND c."principalCompanyId" IS NULL;

-- Sem esse vínculo (contas antigas ou criadas pelo admin do sistema), vale o
-- administrador mais antigo com acesso ao sistema.
UPDATE "companies" AS c
SET "ownerUserId" = o."userId"
FROM (
  SELECT DISTINCT ON (e."companyId") e."companyId", e."userId"
  FROM "employees" AS e
  JOIN "roles" AS r ON r."id" = e."roleId"
  WHERE r."isAdmin" = true AND e."userId" IS NOT NULL
  ORDER BY e."companyId", e."createdAt" ASC
) AS o
WHERE o."companyId" = c."id"
  AND c."ownerUserId" IS NULL
  AND c."principalCompanyId" IS NULL;
