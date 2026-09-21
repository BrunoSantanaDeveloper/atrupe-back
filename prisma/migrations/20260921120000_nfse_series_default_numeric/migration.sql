-- A serie da NFS-e entra no Id do DPS do Emissor Nacional e e validada contra
-- TSSerieDPS ([0-9]{1,4}|[0-8][0-9]{4}): "A1" (o padrao antigo) e recusado com
-- "[#inv0357] - O valor informado no campo serie e incorreto".
-- Muda apenas o padrao de quem nasce agora; linhas existentes seguem como estao
-- porque municipios em layout proprio ainda aceitam serie alfanumerica.
ALTER TABLE "invoicy_environment_configs" ALTER COLUMN "nfseSeries" SET DEFAULT '1';
