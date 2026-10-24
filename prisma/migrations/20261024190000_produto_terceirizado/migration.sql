-- Produto terceirizado (T-5) e o serviço terceirizado como item (T-6), 24/10/2026
ALTER TYPE "QuotationItemOrigin" ADD VALUE 'OUTSOURCED';

ALTER TABLE "products" ADD COLUMN "isOutsourced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "outsourcedCost" DOUBLE PRECISION;

CREATE TABLE "_ProductSuppliers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);
CREATE UNIQUE INDEX "_ProductSuppliers_AB_unique" ON "_ProductSuppliers"("A", "B");
CREATE INDEX "_ProductSuppliers_B_index" ON "_ProductSuppliers"("B");
ALTER TABLE "_ProductSuppliers" ADD CONSTRAINT "_ProductSuppliers_A_fkey" FOREIGN KEY ("A") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProductSuppliers" ADD CONSTRAINT "_ProductSuppliers_B_fkey" FOREIGN KEY ("B") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
