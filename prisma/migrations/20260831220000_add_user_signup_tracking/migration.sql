-- Rastreamento da conversao de cadastro.
--
-- signupEventId e' o identificador da conversao, gerado no backend e devolvido
-- ao frontend para o OpenAI Pixel e para a Conversions API. E' unico porque o
-- mesmo cadastro e' reportado pelo navegador e pelo servidor, e o id e' o que
-- permite deduplicar os dois envios.
--
-- As tres colunas nascem nulas: os usuarios ja cadastrados nao tem esses dados
-- e nao ha de onde derivá-los. O indice unico do Postgres admite multiplos
-- NULLs, entao ele convive com a base existente sem backfill.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signupEventId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signupOppref" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signupUtm" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "users_signupEventId_key" ON "users"("signupEventId");
