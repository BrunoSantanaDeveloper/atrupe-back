import {
  createSectorBaseProducts,
  sectorBaseProducts,
} from './sector-base-products';
import { BASE_PRODUCTS } from './products-base';

describe('Produto base por setor', () => {
  it('um por setor que tem produto padrão', () => {
    const bases = sectorBaseProducts();
    const sectors = new Set(BASE_PRODUCTS.map((p) => p.setorNome));
    expect(bases).toHaveLength(sectors.size);
    expect(bases.map((b) => b.setorNome).sort()).toEqual([...sectors].sort());
    expect(bases[0].nome).toBe(`Produto base – ${bases[0].setorNome}`);
    expect(new Set(bases.map((b) => b.codigo)).size).toBe(bases.length);
  });

  it('cria com preço zero e as duas liberações', async () => {
    const products: any[] = [];
    const items: any[] = [];
    const db: any = {
      product: {
        create: jest.fn(async ({ data }) => {
          products.push(data);
          return { id: `p${products.length}` };
        }),
      },
      productItem: {
        create: jest.fn(async ({ data }) => items.push(data)),
      },
    };
    const bases = sectorBaseProducts();
    const sectors = bases.map((b, i) => ({ id: `s${i}`, name: b.setorNome }));
    const categories = bases.map((b) => ({
      id: `c-${b.categoriaNome}`,
      name: b.categoriaNome,
    }));
    const created = await createSectorBaseProducts(
      db,
      'empresa',
      sectors,
      categories,
    );
    expect(created).toBe(bases.length);
    expect(
      products.every((p) => p.allowEditValues && p.allowEditDescription),
    ).toBe(true);
    expect(items.every((i) => i.salePrice === 0 && i.unitCost === 0)).toBe(
      true,
    );
    expect(products[0].productionStages).toEqual([
      { id: 's0', isActive: true },
    ]);
  });

  it('pula o setor ou a categoria que a empresa não tem', async () => {
    const db: any = {
      product: { create: jest.fn(async () => ({ id: 'p' })) },
      productItem: { create: jest.fn() },
    };
    expect(await createSectorBaseProducts(db, 'empresa', [], [])).toBe(0);
    expect(db.product.create).not.toHaveBeenCalled();
  });
});
