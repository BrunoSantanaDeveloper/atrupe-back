-- CRM fase 2 (27/10/2026): contatos registrados na negociação e a
-- configuração do acompanhamento (modelos de mensagem, e-mail diário,
-- dias para o cliente contar como sem compra).

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('WHATSAPP', 'PHONE', 'EMAIL', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "ContactOutcome" AS ENUM ('WAITING_CLIENT', 'ADJUST_REQUESTED', 'WILL_CLOSE', 'NO_RESPONSE', 'OTHER');

-- CreateTable
CREATE TABLE "quotation_contacts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "clientId" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "channel" "ContactChannel" NOT NULL DEFAULT 'WHATSAPP',
    "outcome" "ContactOutcome" NOT NULL DEFAULT 'WAITING_CLIENT',
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "templateProposalSent" TEXT,
    "templateValidity" TEXT,
    "templateResume" TEXT,
    "dailyEmail" BOOLEAN NOT NULL DEFAULT false,
    "dailyEmailHour" INTEGER NOT NULL DEFAULT 8,
    "inactiveDays" INTEGER NOT NULL DEFAULT 90,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotation_contacts_quotationId_at_idx" ON "quotation_contacts"("quotationId", "at");
CREATE INDEX "quotation_contacts_clientId_at_idx" ON "quotation_contacts"("clientId", "at");
CREATE INDEX "quotation_contacts_companyId_at_idx" ON "quotation_contacts"("companyId", "at");
CREATE UNIQUE INDEX "follow_up_settings_companyId_key" ON "follow_up_settings"("companyId");

-- AddForeignKey
ALTER TABLE "quotation_contacts" ADD CONSTRAINT "quotation_contacts_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
