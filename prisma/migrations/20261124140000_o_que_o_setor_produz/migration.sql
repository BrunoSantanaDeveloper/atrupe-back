-- O que o setor produz (PS-1; Maicol, 23/11/2026): as produções que a
-- empresa liga à mão em cada setor.
ALTER TABLE "sectors" ADD COLUMN "productions" TEXT[] DEFAULT ARRAY[]::TEXT[];
