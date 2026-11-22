-- O intervalo (almoço) no expediente da empresa; o gerenciador novo copia (GP-49)
ALTER TABLE "production_calendars" ADD COLUMN "breakStart" TEXT,
ADD COLUMN "breakEnd" TEXT;
