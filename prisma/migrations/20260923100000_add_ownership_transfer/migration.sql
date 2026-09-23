-- Transferência de titularidade e períodos de titularidade.
--
-- Aditivo e reexecutável (IF NOT EXISTS), como as anteriores.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ownership_transfers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "fromUserName" TEXT NOT NULL,
    "targetEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "canceledAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "previousCnpj" TEXT,
    "newCnpj" TEXT,

    CONSTRAINT "ownership_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ownership_periods" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "holderName" TEXT NOT NULL,
    "document" TEXT,
    "email" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "transferId" TEXT,

    CONSTRAINT "ownership_periods_pkey" PRIMARY KEY ("id")
);

-- Transferência que trocou o CNPJ: o que é fiscal de antes vira histórico.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "fiscalResetAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ownership_transfers_tokenHash_key" ON "ownership_transfers"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ownership_transfers_companyId_status_idx" ON "ownership_transfers"("companyId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ownership_periods_companyId_endedAt_idx" ON "ownership_periods"("companyId", "endedAt");

-- Toda conta nasce com um período de titularidade aberto: sem ele, a primeira
-- transferência não teria o que fechar, e o histórico começaria pelo segundo
-- dono. As contas existentes ganham o delas a partir da criação, com o titular
-- registrado (só empresas principais; filiais seguem a principal).
INSERT INTO "ownership_periods" ("id", "companyId", "userId", "holderName", "document", "email", "startedAt")
SELECT
    gen_random_uuid()::text,
    c."id",
    c."ownerUserId",
    COALESCE(NULLIF(c."legalName", ''), c."name"),
    c."cnpj",
    u."email",
    c."createdAt"
FROM "companies" c
LEFT JOIN "users" u ON u."id" = c."ownerUserId"
WHERE c."principalCompanyId" IS NULL
  AND c."ownerUserId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ownership_periods" p WHERE p."companyId" = c."id"
  );
