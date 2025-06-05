-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3);
