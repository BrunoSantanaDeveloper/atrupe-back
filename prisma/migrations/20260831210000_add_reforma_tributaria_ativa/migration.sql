-- Ativacao do layout da Reforma Tributaria na NF-e/NFC-e.
--
-- O grupo IBS/CBS nao existe no layout de emissao vigente do provedor: ele vive
-- num layout paralelo, ativado pelo provedor por empresa e por modulo. Esta
-- coluna espelha o campo AtivacaoReformaTributaria devolvido na consulta de
-- cadastro de empresa, e nasce desligada para nao alterar quem ja emite.
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "reformaTributariaAtiva" BOOLEAN NOT NULL DEFAULT false;
