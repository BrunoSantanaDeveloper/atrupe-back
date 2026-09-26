-- O Administrador Principal da Conta (Usuário nº 1) indicado no aceite do
-- contrato (contrato 1.1, cláusulas 1.5 e 4.1).
ALTER TABLE "contract_acceptances" ADD COLUMN IF NOT EXISTS "principalAdminUserId" TEXT;
ALTER TABLE "contract_acceptances" ADD COLUMN IF NOT EXISTS "principalAdminName" TEXT;
ALTER TABLE "contract_acceptances" ADD COLUMN IF NOT EXISTS "principalAdminEmail" TEXT;
