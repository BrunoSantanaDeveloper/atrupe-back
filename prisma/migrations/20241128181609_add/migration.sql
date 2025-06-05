-- CreateEnum
CREATE TYPE "SheetStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('INCREASE', 'DISCOUNT', 'ADVANCE');

-- CreateEnum
CREATE TYPE "PaymentSalaryStatus" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "SalarySheet" (
    "id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "SheetStatus" NOT NULL DEFAULT 'OPEN',
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalarySheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryItem" (
    "id" TEXT NOT NULL,
    "salarySheetId" TEXT NOT NULL,
    "type" "ItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMovement" (
    "id" TEXT NOT NULL,
    "salarySheetId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidDate" TIMESTAMP(3) NOT NULL,
    "paymentStatus" "PaymentSalaryStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethodId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalarySheet_employeeId_month_year_key" ON "SalarySheet"("employeeId", "month", "year");

-- AddForeignKey
ALTER TABLE "SalarySheet" ADD CONSTRAINT "SalarySheet_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryItem" ADD CONSTRAINT "SalaryItem_salarySheetId_fkey" FOREIGN KEY ("salarySheetId") REFERENCES "SalarySheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMovement" ADD CONSTRAINT "PaymentMovement_salarySheetId_fkey" FOREIGN KEY ("salarySheetId") REFERENCES "SalarySheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMovement" ADD CONSTRAINT "PaymentMovement_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
