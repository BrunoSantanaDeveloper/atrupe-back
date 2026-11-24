-- O veículo é o patrimônio (VE-1; Maicol, 23/11/2026): o veículo da
-- produção aponta para o bem da frota.
ALTER TABLE "production_vehicles" ADD COLUMN "assetId" TEXT;
