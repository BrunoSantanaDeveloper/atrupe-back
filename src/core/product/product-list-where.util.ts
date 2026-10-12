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
  /** Com composição (etapas na composição padrão), ou sem (CP-17) */
  hasComposition?: boolean;
  /** A lista do orçamento: sem o inativo, o em edição e a parte (IP-14) */
  forSale?: boolean;
}

/** A composição padrão com ao menos uma etapa. */
const COMPOSED = {
  variationKey: '',
  blocks: { some: {} },
} satisfies Prisma.ProductAssemblyWhereInput;

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

  const extra: Prisma.ProductWhereInput[] = [];
  if (filter.hasComposition === true) {
    extra.push({ assemblies: { some: COMPOSED } });
  } else if (filter.hasComposition === false) {
    extra.push({ NOT: { assemblies: { some: COMPOSED } } });
  }
  if (filter.forSale) {
    // O produto sem composição continua vendável (START)
    where = { ...where, isActive: true };
    extra.push({
      NOT: {
        assemblies: {
          some: { ...COMPOSED, status: { in: ['DRAFT', 'PART'] } },
        },
      },
    });
  }
  if (extra.length) {
    const current = where.AND
      ? Array.isArray(where.AND)
        ? where.AND
        : [where.AND]
      : [];
    where = { ...where, AND: [...current, ...extra] };
  }

  return where;
}
