-- Prevent two correction letters for the same NF-e from sharing the same event sequence.
CREATE UNIQUE INDEX "nfe_correction_events_nfeId_sequenciaEvento_key"
ON "nfe_correction_events"("nfeId", "sequenciaEvento");
