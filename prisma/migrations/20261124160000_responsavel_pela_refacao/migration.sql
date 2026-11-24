-- O responsável pela refação (GP-51; Maicol, 23/11/2026): a pessoa ou o
-- setor que causou o erro.
ALTER TABLE "order_redos" ADD COLUMN "responsibleKind" TEXT;
ALTER TABLE "order_redos" ADD COLUMN "responsibleId" TEXT;
ALTER TABLE "order_redos" ADD COLUMN "responsibleName" TEXT;
