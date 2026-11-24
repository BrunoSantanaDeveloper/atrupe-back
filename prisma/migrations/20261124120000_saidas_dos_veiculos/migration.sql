-- Veículos, fase 1 (Maicol, 23/11/2026, ELITE): a saída com as paradas, o
-- pedido de veículo e o km da volta repartido pelo previsto.
CREATE TYPE "ProductionTripStatus" AS ENUM ('SCHEDULED', 'ON_ROUTE', 'DONE', 'CANCELED');
CREATE TYPE "ProductionStopKind" AS ENUM ('WORK', 'FREE');
CREATE TYPE "ProductionStopStatus" AS ENUM ('PENDING', 'DONE', 'NOT_DONE');
CREATE TYPE "ProductionVehicleRequestStatus" AS ENUM ('OPEN', 'SCHEDULED', 'CANCELED');

CREATE TABLE "production_trips" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "teamIds" TEXT[],
    "departAt" TIMESTAMP(3) NOT NULL,
    "returnAt" TIMESTAMP(3) NOT NULL,
    "status" "ProductionTripStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startedAt" TIMESTAMP(3),
    "odometerStart" DOUBLE PRECISION,
    "finishedAt" TIMESTAMP(3),
    "odometerEnd" DOUBLE PRECISION,
    "km" DOUBLE PRECISION,
    "note" TEXT,
    "cancelReason" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "closedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "production_trips_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "production_trips_companyId_number_key" ON "production_trips"("companyId", "number");
CREATE INDEX "production_trips_companyId_departAt_idx" ON "production_trips"("companyId", "departAt");
CREATE INDEX "production_trips_vehicleId_idx" ON "production_trips"("vehicleId");
ALTER TABLE "production_trips" ADD CONSTRAINT "production_trips_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "production_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_trips" ADD CONSTRAINT "production_trips_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "production_trip_stops" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "kind" "ProductionStopKind" NOT NULL DEFAULT 'WORK',
    "taskId" TEXT,
    "description" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "sectorId" TEXT,
    "sectorName" TEXT NOT NULL DEFAULT '',
    "plannedKm" DOUBLE PRECISION,
    "km" DOUBLE PRECISION,
    "status" "ProductionStopStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "doneAt" TIMESTAMP(3),
    "doneByName" TEXT,
    CONSTRAINT "production_trip_stops_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "production_trip_stops_tripId_idx" ON "production_trip_stops"("tripId");
CREATE INDEX "production_trip_stops_taskId_idx" ON "production_trip_stops"("taskId");
ALTER TABLE "production_trip_stops" ADD CONSTRAINT "production_trip_stops_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "production_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_trip_stops" ADD CONSTRAINT "production_trip_stops_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "production_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "production_vehicle_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "sectorId" TEXT,
    "sectorName" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL,
    "destination" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "status" "ProductionVehicleRequestStatus" NOT NULL DEFAULT 'OPEN',
    "tripId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "production_vehicle_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "production_vehicle_requests_companyId_status_idx" ON "production_vehicle_requests"("companyId", "status");
