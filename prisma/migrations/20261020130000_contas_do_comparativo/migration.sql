-- As contas das fontes sem bem no comparativo da base de custos: o material
-- das vendas e o custo financeiro. Nulas, vale a conta padrão pela descrição.

-- AlterTable
ALTER TABLE "cost_base_settings" ADD COLUMN     "financialCostSubCategoryId" TEXT,
ADD COLUMN     "materialSubCategoryId" TEXT;
