-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "birthdate" TIMESTAMP(3),
ADD COLUMN     "financialNotes" TEXT,
ADD COLUMN     "nickname" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "site" TEXT;
