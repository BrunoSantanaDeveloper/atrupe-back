-- Cadastro da frente de caixa (Fase 7.6): o arredondamento no balcão em
-- valor ou em percentual (FC-18) e quem fechou a sessão, o operador ou o
-- responsável que fechou o caixa esquecido (FC-14).

-- CreateEnum
CREATE TYPE "CashRoundingType" AS ENUM ('VALUE', 'PERCENT');

-- AlterTable
ALTER TABLE "cash_fronts" ADD COLUMN     "roundingType" "CashRoundingType" NOT NULL DEFAULT 'VALUE';

-- AlterTable
ALTER TABLE "cash_sessions" ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "closedByName" TEXT;
