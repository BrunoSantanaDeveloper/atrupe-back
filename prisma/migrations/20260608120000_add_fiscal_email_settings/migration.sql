-- Add fiscal e-mail sending preferences to the default emitter configuration.
ALTER TABLE "invoicy_configs"
ADD COLUMN "sendDanfeXmlAutomatically" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sendDanfeAutomatically" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "sendXmlAutomatically" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "sendFiscalEmailCopyTo" TEXT;

-- Track the latest NF-e fiscal e-mail delivery attempt.
ALTER TABLE "nfes"
ADD COLUMN "emailSentAt" TIMESTAMP(3),
ADD COLUMN "emailSentTo" TEXT,
ADD COLUMN "emailSendError" TEXT;
