/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `mail_verifications` will be added. If there are existing duplicate values, this will fail.
  - Made the column `email` on table `mail_verifications` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "mail_verifications" ALTER COLUMN "email" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "mail_verifications_email_key" ON "mail_verifications"("email");
