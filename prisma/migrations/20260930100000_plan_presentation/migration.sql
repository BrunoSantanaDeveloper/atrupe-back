-- Textos do card do plano na trilha de contratação ({ pitch, actions }),
-- editados pelo superadmin no painel de planos. Nulo = o texto padrão.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "presentation" JSONB;
