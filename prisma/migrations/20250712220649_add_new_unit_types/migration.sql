-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UnitOfMeasureKind" ADD VALUE 'DISTANCE';
ALTER TYPE "UnitOfMeasureKind" ADD VALUE 'DURATION';
ALTER TYPE "UnitOfMeasureKind" ADD VALUE 'UNITY';
ALTER TYPE "UnitOfMeasureKind" ADD VALUE 'AREA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UnitOfMeasureVariant" ADD VALUE 'KM';
ALTER TYPE "UnitOfMeasureVariant" ADD VALUE 'HH';
ALTER TYPE "UnitOfMeasureVariant" ADD VALUE 'UN';
ALTER TYPE "UnitOfMeasureVariant" ADD VALUE 'M2';
