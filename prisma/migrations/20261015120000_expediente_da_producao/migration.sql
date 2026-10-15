-- O expediente da produção (Fase 6, decisão de 15/10/2026): os dias e o
-- horário de trabalho e os feriados da empresa, para a cadeia de alertas do
-- gerenciador. Sem linha, segunda a sexta, das 08:00 às 18:00.

-- CreateTable
CREATE TABLE "production_calendars" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "startTime" TEXT NOT NULL DEFAULT '08:00',
    "endTime" TEXT NOT NULL DEFAULT '18:00',
    "holidays" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_calendars_companyId_key" ON "production_calendars"("companyId");

-- AddForeignKey
ALTER TABLE "production_calendars" ADD CONSTRAINT "production_calendars_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
