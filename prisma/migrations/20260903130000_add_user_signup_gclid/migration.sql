-- gclid: identificador de clique do Google Ads, guardado no cadastro para
-- atribuir a conversao na origem certa.
--
-- Nasce nula: usuarios ja cadastrados nao tem esse dado e nao ha de onde
-- deriva-lo. Sem indice unico — ao contrario de signupEventId, o mesmo clique
-- pode legitimamente originar mais de um cadastro.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signupGclid" TEXT;
