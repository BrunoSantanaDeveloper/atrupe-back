-- A etapa "Seus setores de produção" (área 9 §4.16; Maicol, 26/11/2026)
-- aparece para a conta que entra no LITE. As contas que já existem não
-- passam por ela: os setores delas continuam como estão.
ALTER TABLE "companies" ADD COLUMN "productionSectorsSetAt" TIMESTAMP(3);
UPDATE "companies" SET "productionSectorsSetAt" = NOW();
