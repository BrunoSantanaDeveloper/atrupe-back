import { buildProductListWhere } from './product-list-where.util';

/** O filtro da composição na lista de produtos (CP-17, IP-14). */
describe('buildProductListWhere: composição', () => {
  const composed = { variationKey: '', blocks: { some: {} } };

  it('com e sem composição olham a composição padrão com etapas', () => {
    expect(buildProductListWhere({ hasComposition: true }).AND).toEqual([
      { assemblies: { some: composed } },
    ]);
    expect(buildProductListWhere({ hasComposition: false }).AND).toEqual([
      { NOT: { assemblies: { some: composed } } },
    ]);
  });

  it('para venda: só ativos, sem a composição em edição ou só parte', () => {
    const where = buildProductListWhere({ forSale: true, status: 'INACTIVE' });
    expect(where.isActive).toBe(true);
    expect(where.AND).toEqual([
      {
        NOT: {
          assemblies: {
            some: { ...composed, status: { in: ['DRAFT', 'PART'] } },
          },
        },
      },
    ]);
  });

  it('a busca continua junto com os filtros novos', () => {
    const where = buildProductListWhere({
      search: 'banner',
      hasComposition: true,
    });
    expect(where.AND).toHaveLength(2);
  });

  it('sem os filtros novos, nada muda', () => {
    expect(buildProductListWhere({ companyId: 'c-1' })).toEqual({
      companyId: 'c-1',
      isActive: true,
    });
  });
});
