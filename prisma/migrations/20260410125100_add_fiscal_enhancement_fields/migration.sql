-- AlterTable: PaymentCondition - add fiscal invoice generation fields
ALTER TABLE "payment_conditions"
ADD COLUMN "generateInvoice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "invoiceType" TEXT;

-- AlterTable: Client - add fiscal registration fields
ALTER TABLE "clients"
ADD COLUMN "stateRegistration" TEXT,
ADD COLUMN "indicadorIE" INTEGER DEFAULT 9;

-- AlterTable: Supplier - add fiscal registration fields
ALTER TABLE "suppliers"
ADD COLUMN "stateRegistration" TEXT,
ADD COLUMN "indicadorIE" INTEGER DEFAULT 9;

-- AlterTable: InvoicyConfig - re-add IBGE cache + add CSC NFC-e
ALTER TABLE "invoicy_configs"
ADD COLUMN "emitCmun" TEXT,
ADD COLUMN "cscId" TEXT,
ADD COLUMN "cscToken" TEXT;
