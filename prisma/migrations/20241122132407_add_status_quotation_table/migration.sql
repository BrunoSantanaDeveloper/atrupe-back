-- CreateTable
CREATE TABLE "status_quotation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL,
    "color" TEXT NOT NULL,

    CONSTRAINT "status_quotation_pkey" PRIMARY KEY ("id")
);
