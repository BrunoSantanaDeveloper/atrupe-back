-- Papéis no LITE (decisão do PO de 13/10/2026): a variação do produto aponta
-- para o papel (um material da empresa com a forma SHEET). Opcional; o papel
-- que sai do banco solta a variação (SET NULL).

-- AlterTable
ALTER TABLE "product_variations" ADD COLUMN     "paperId" TEXT;

-- AddForeignKey
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
