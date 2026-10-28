-- Data de cadastro do produto (LITE part3, item 4, 28/10/2026): a lista de
-- produtos segue a ordem de cadastro. Os produtos de antes desta coluna
-- ficam com a data da migração e, entre eles, seguem por nome.
ALTER TABLE "products" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
