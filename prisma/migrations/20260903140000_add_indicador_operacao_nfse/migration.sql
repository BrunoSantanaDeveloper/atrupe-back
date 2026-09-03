-- Padrao do codigo indicador da operacao (cIndOp) da NFS-e.
--
-- O campo e obrigatorio no layout da Reforma Tributaria e nao muda de uma
-- emissao para outra na maioria dos casos: sem padrao, o usuario precisava
-- digita-lo a cada nota. Nasce nulo — emissor sem padrao definido segue
-- exigindo o valor na emissao, que e o comportamento atual.
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "indicadorOperacaoNfse" TEXT;
