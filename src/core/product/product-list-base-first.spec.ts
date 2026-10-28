import { BASE_PRODUCT_WHERE, ProductService } from './product.service';

/**
 * O Produto base do setor vem antes dos outros na lista (ALT-8, pacote de
 * 26/10/2026), com a paginação contando os dois grupos.
 */
describe('ProductService.findAll — Produto base primeiro', () => {
  const row = (name: string) => ({
    id: name,
    name,
    code: null,
    isActive: true,
    isOutsourced: false,
    sector: null,
    category: null,
    items: [],
    fiscalData: null,
    assemblies: [],
    _count: { variations: 0 },
  });

  function setup(bases: string[], others: string[]) {
    const isBases = (where: any) => where?.AND?.[1] === BASE_PRODUCT_WHERE;
    const prisma = {
      product: {
        count: jest.fn(async ({ where }) =>
          isBases(where) ? bases.length : bases.length + others.length,
        ),
        findMany: jest.fn(async ({ where, skip, take }) =>
          (isBases(where) ? bases : others).slice(skip, skip + take).map(row),
        ),
      },
    };
    return {
      prisma,
      service: new ProductService(prisma as any, {} as any),
    };
  }

  const names = (result: any) => result.data.map((product) => product.name);

  it('a primeira página abre com os Produtos base', async () => {
    const { service } = setup(
      ['Produto base – Gráfica', 'Produto base – Comunicação'],
      ['Adesivo', 'Banner', 'Cartão'],
    );
    const result = await service.findAll({
      companyId: 'empresa-a',
      page: '1',
      limit: '3',
    } as any);
    expect(result.total).toBe(5);
    expect(names(result)).toEqual([
      'Produto base – Gráfica',
      'Produto base – Comunicação',
      'Adesivo',
    ]);
  });

  it('a página seguinte continua a lista sem repetir', async () => {
    const { service, prisma } = setup(
      ['Produto base – Gráfica', 'Produto base – Comunicação'],
      ['Adesivo', 'Banner', 'Cartão'],
    );
    const result = await service.findAll({
      companyId: 'empresa-a',
      page: '2',
      limit: '3',
    } as any);
    expect(names(result)).toEqual(['Banner', 'Cartão']);
    // Nenhum Produto base cabe na página 2: só a lista dos outros é lida
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
  });
});
