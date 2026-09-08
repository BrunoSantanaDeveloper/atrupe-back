import { Prisma } from '@prisma/client';

/**
 * Filtros da listagem de produtos, sem paginação.
 *
 * Espelha os campos de `ProductFilterDTO` que entram no `where`; `page`,
 * `limit` e afins não influenciam quais produtos são atingidos.
 */
export interface ProductListFilter {
  companyId?: string;
  categoryId?: string;
  unitKind?: string;
  sectorId?: string;
  categoryKind?: string;
  isService?: boolean;
  /** 'ACTIVE' | 'INACTIVE'; ausente mostra só ativos. */
  status?: string;
  search?: string;
}

/**
 * `where` da listagem de produtos.
 *
 * Extraído de `ProductService.findAll` para a alteração de NCM em massa
 * atingir exatamente o mesmo conjunto que a tela mostra quando o usuário
 * escolhe "todos os N produtos". Uma função pura, e não uma injeção de
 * `ProductService` no serviço fiscal, porque `ProductService` já injeta
 * `ProductFiscalService` — o contrário fecharia um ciclo de dependências.
 */
export function buildProductListWhere(
  filter: ProductListFilter,
): Prisma.ProductWhereInput {
  let where: Prisma.ProductWhereInput = {};

  if (filter.companyId) {
    where = { ...where, companyId: filter.companyId };
  }

  if (filter.categoryId) {
    where = { ...where, categoryId: filter.categoryId };
  }

  if (filter.unitKind) {
    where = {
      ...where,
      items: {
        some: {
          unitKind: filter.unitKind as any,
        },
      },
    };
  }

  if (filter.sectorId) {
    where = { ...where, sectorId: filter.sectorId };
  }

  if (filter.categoryKind) {
    where = {
      ...where,
      category: {
        kind: filter.categoryKind as any,
      },
    };
  }

  if (filter.isService !== undefined) {
    where = { ...where, isService: filter.isService };
  }

  // Sem status informado, a listagem mostra apenas ativos.
  if (filter.status) {
    where = { ...where, isActive: filter.status === 'ACTIVE' };
  } else {
    where = { ...where, isActive: true };
  }

  if (filter.search) {
    where = {
      ...where,
      AND: [
        {
          OR: [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { code: { contains: filter.search, mode: 'insensitive' } },
            {
              technicalDescription: {
                contains: filter.search,
                mode: 'insensitive',
              },
            },
          ],
        },
      ],
    };
  }

  return where;
}
