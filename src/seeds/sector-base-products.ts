import type { PrismaClient } from '@prisma/client';
import { BASE_PRODUCTS } from './products-base';

/**
 * Produto base por setor (decisão do produto, 24/10/2026, junto da ALT-8).
 *
 * Comunicação visual vive de produto personalizado: o "Produto base" de cada
 * setor é a porta oficial para vender o que não está cadastrado, com preço
 * R$ 0,00 (sem preço base, sem limite de desconto) e a edição de valor e de
 * descrição liberadas. Os produtos padrão vêm sem essas liberações, para o
 * limite de desconto do vendedor valer sobre o preço do cadastro.
 *
 * Um por setor que já tem produto padrão: são os setores da grade da venda,
 * e a produção já sai no setor certo.
 */
export const sectorBaseProducts = () => {
  const bySector = new Map<string, string>();
  for (const product of BASE_PRODUCTS) {
    if (!bySector.has(product.setorNome)) {
      bySector.set(product.setorNome, product.categoriaNome);
    }
  }
  return [...bySector].map(([setorNome, categoriaNome], index) => ({
    nome: `Produto base – ${setorNome}`,
    codigo: `BASE${String(index + 1).padStart(2, '0')}`,
    setorNome,
    categoriaNome,
  }));
};

type Db = Pick<PrismaClient, 'product' | 'productItem'>;

/** Cria o Produto base de cada setor; devolve quantos criou. */
export async function createSectorBaseProducts(
  db: Db,
  companyId: string,
  sectors: { id: string; name: string }[],
  categories: { id: string; name: string }[],
) {
  let created = 0;
  for (const base of sectorBaseProducts()) {
    const sector = sectors.find((item) => item.name === base.setorNome);
    const category = categories.find(
      (item) => item.name === base.categoriaNome,
    );
    if (!sector || !category) continue;
    const product = await db.product.create({
      data: {
        name: base.nome,
        code: base.codigo,
        categoryId: category.id,
        sectorId: sector.id,
        companyId,
        productionStages: [{ id: sector.id, isActive: true }],
        isStandard: true,
        allowEditValues: true,
        allowEditDescription: true,
      },
    });
    await db.productItem.create({
      data: {
        name: base.nome,
        productId: product.id,
        unitKind: 'UNITY',
        salePrice: 0,
        unitCost: 0,
      },
    });
    created += 1;
  }
  return created;
}
