-- Envelope da resposta do Invoicy na emissão de NFS-e.
-- Sem ele a rejeição preserva apenas Situacao.SitDescricao, e o código de
-- retorno do provedor (que é onde mora a causa) se perde.
ALTER TABLE "nfses" ADD COLUMN IF NOT EXISTS "invoicyRetornoBruto" JSONB;
