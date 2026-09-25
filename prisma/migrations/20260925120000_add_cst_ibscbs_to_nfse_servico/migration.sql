-- O grupo IBSCBS do RPS exige CST e cClassTrib juntos. A lista de servicos so
-- guardava a classificacao, entao o formulario mandava cstIbsCbs, o DTO
-- recusava (forbidNonWhitelisted) e o cadastro inteiro falhava com 400.
ALTER TABLE "nfse_servicos" ADD COLUMN "cstIbsCbs" TEXT;
