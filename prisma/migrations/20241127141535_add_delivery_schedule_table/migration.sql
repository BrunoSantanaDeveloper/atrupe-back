-- CreateEnum
CREATE TYPE "DeliveryScheduleStatus" AS ENUM ('IN_PRODUCTION', 'DELIVERING', 'DONE');

-- CreateEnum
CREATE TYPE "ProductionStageStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'PENDING', 'DONE', 'CANCELED', 'WAITING_PRODUCTION', 'OVERDUE');

-- CreateTable
CREATE TABLE "DeliverySchedule" (
    "id" TEXT NOT NULL,
    "status" "DeliveryScheduleStatus" NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "addScheduleTime" BOOLEAN NOT NULL DEFAULT false,
    "pendingDescription" TEXT,
    "orderId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "DeliverySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionStage" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" "ProductionStageStatus" NOT NULL,
    "prevStatus" TEXT,
    "scheduleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionStage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DeliverySchedule" ADD CONSTRAINT "DeliverySchedule_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionStage" ADD CONSTRAINT "ProductionStage_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "DeliverySchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
