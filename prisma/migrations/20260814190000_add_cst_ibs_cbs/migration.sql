-- CST do IBS/CBS no cadastro fiscal do serviço/produto.
--
-- O grupo IBSCBS da NFS-e (schema InvoiCy_NFSe_Reforma_tributaria.xsd) exige
-- CSTIBSCBS junto de cClassTrib. Até aqui só a classificação era enviada, o que
-- produz um grupo incompleto e sujeito a rejeição de schema pela prefeitura.
--
-- O default "000" (tributação integral) pareia com o default já existente de
-- codClassificacao "000001" (situações tributadas integralmente pelo IBS e CBS).
ALTER TABLE "product_fiscal_data" ADD COLUMN IF NOT EXISTS "cstIbsCbs" TEXT DEFAULT '000';
