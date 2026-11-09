-- Ordens que entraram numa NFS-e consolidada.
--
-- "nfses"."orderId" guarda uma ordem só. Na emissão consolidada ele ficava com
-- a primeira e as demais não tinham vínculo nenhum: apareciam como "Não
-- emitida" na listagem e passavam pela guarda de duplicidade, que lê as notas
-- da ordem — dava para emitir uma segunda NFS-e do mesmo serviço. A lista
-- completa existia apenas dentro de "draftData", que nenhuma consulta olhava.
-- Esta tabela é o espelho de "nfe_orders", que a NF-e já tinha.
CREATE TABLE IF NOT EXISTS "nfse_orders" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nfseId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    CONSTRAINT "nfse_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "nfse_orders_nfseId_orderId_key" ON "nfse_orders"("nfseId", "orderId");
CREATE INDEX IF NOT EXISTS "nfse_orders_orderId_idx" ON "nfse_orders"("orderId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nfse_orders_nfseId_fkey'
  ) THEN
    ALTER TABLE "nfse_orders" ADD CONSTRAINT "nfse_orders_nfseId_fkey" FOREIGN KEY ("nfseId") REFERENCES "nfses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nfse_orders_orderId_fkey'
  ) THEN
    ALTER TABLE "nfse_orders" ADD CONSTRAINT "nfse_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: o que já foi consolidado vive em "draftData"->'consolidatedOrderIds'.
-- Sem isto as notas consolidadas antigas continuariam com 1 vínculo de N.
INSERT INTO "nfse_orders" ("id", "createdAt", "nfseId", "orderId")
SELECT gen_random_uuid()::text, n."createdAt", n."id", o."id"
FROM "nfses" n
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(n."draftData"->'consolidatedOrderIds') = 'array'
    THEN n."draftData"->'consolidatedOrderIds'
    ELSE '[]'::jsonb
  END
) AS consolidado(order_id)
JOIN "orders" o ON o."id" = consolidado.order_id
ON CONFLICT ("nfseId", "orderId") DO NOTHING;

-- A ordem principal continua em "nfses"."orderId"; registra também o vínculo
-- para que toda leitura possa usar uma fonte só.
INSERT INTO "nfse_orders" ("id", "createdAt", "nfseId", "orderId")
SELECT gen_random_uuid()::text, n."createdAt", n."id", n."orderId"
FROM "nfses" n
WHERE n."orderId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = n."orderId")
ON CONFLICT ("nfseId", "orderId") DO NOTHING;
