-- CreateTable
CREATE TABLE "sale_series" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "taxCosts" JSONB,
    "deliveryDuration" INTEGER NOT NULL,
    "quotaDuration" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sale_series_pkey" PRIMARY KEY ("id")
);
