ALTER TABLE "nfe_correction_events"
ADD COLUMN IF NOT EXISTS "xmlEvento" TEXT;

CREATE TABLE IF NOT EXISTS "nfe_danfe_documents" (
    "nfeId" TEXT NOT NULL,
    "pdf" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfe_danfe_documents_pkey" PRIMARY KEY ("nfeId")
);

DO $$ BEGIN
    ALTER TABLE "nfe_danfe_documents"
    ADD CONSTRAINT "nfe_danfe_documents_nfeId_fkey"
    FOREIGN KEY ("nfeId") REFERENCES "nfes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
