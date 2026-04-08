-- CreateIndex: Prevent duplicate OPEN cash registers for the same bank account
-- This is a partial unique index that only applies when status is 'OPEN'
CREATE UNIQUE INDEX IF NOT EXISTS "cash_registers_bank_account_open_unique"
  ON "cash_registers" ("bankAccountId")
  WHERE "status" = 'OPEN';
