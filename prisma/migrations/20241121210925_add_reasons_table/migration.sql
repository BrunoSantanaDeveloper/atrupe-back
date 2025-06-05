-- CreateEnum
CREATE TYPE "ReasonType" AS ENUM ('REJECTION', 'CANCELLATION');

-- CreateTable
CREATE TABLE "reasons" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "type" "ReasonType" NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "reasons_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "reasons" ADD CONSTRAINT "reasons_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
