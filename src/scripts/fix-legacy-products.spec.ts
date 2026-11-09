import {
  LegacyProduct,
  ProductSnapshot,
  decideStatus,
  decideUnit,
  kindAsMigrated,
  planFixes,
} from './fix-legacy-products';

/**
 * Casos tirados da Terabyte (acn_001578), migrada em 06/11/2026: o "Banner
 * Papel" é cobrado por m² no legado, entrou como unidade a R$ 30,00 e o
 * cliente leu como preço errado.
 */
const legado = (over: Partial<LegacyProduct> = {}): LegacyProduct => ({
  codigo: 'BAN05',
  nome: 'Banner Papel',
  ativo: true,
  unidade: 'M2',
  unidadeMigrada: 'UN',
  valorCentavos: 3000,
  ...over,
});

const produto = (over: Partial<ProductSnapshot> = {}): ProductSnapshot => ({
  id: 'prod-1',
  code: 'BAN05',
  name: 'Banner Papel',
  legacyId: 'BAN05',
  isImported: true,
  isActive: true,
  ownUses: 0,
  items: [
    {
      id: 'item-1',
      unitKind: 'UNITY',
      unitCost: 3000,
      salePrice: 3000,
      width: null,
      height: null,
      length: null,
      duration: null,
    },
  ],
  ...over,
});

const item = (over: Partial<ProductSnapshot['items'][number]>) => [
  { ...produto().items[0], ...over },
];

describe('decideUnit', () => {
  it('passa para m² o produto que a carga gravou como unidade', () => {
    const decisao = decideUnit(legado(), produto());

    expect(decisao.action).toBe('fix');
    if (decisao.action !== 'fix') return;
    expect(decisao.itemId).toBe('item-1');
    expect(decisao.to.unitKind).toBe('AREA');
    // R$ 30,00/m² = 0,003 centavo por mm²; sem medida não há total.
    expect(decisao.to.unitCost).toBeCloseTo(0.003, 12);
    expect(decisao.to.salePrice).toBeNull();
    expect(decisao.from).toEqual({
      unitKind: 'UNITY',
      unitCost: 3000,
      salePrice: 3000,
    });
  });

  it('dá unidade ao produto que entrou sem nenhuma', () => {
    // 130 produtos da Terabyte: UN no legado, sem venda e sem unidade no
    // serviço, e a carga não tinha de onde tirar a unidade.
    const decisao = decideUnit(
      legado({ unidade: 'UN', unidadeMigrada: '', valorCentavos: 6000 }),
      produto({
        items: item({ unitKind: null, unitCost: 6000, salePrice: 6000 }),
      }),
    );

    expect(decisao).toMatchObject({
      action: 'fix',
      to: { unitKind: 'UNITY', unitCost: 6000, salePrice: 6000 },
    });
  });

  it('não mexe no produto que o cliente já passou para m²', () => {
    // BANNER (BAN06) já estava em m² a R$ 60,00 quando a conta foi lida.
    const decisao = decideUnit(
      legado({ codigo: 'BAN06', valorCentavos: 6000 }),
      produto({
        items: item({ unitKind: 'AREA', unitCost: 0.006, salePrice: 4200 }),
      }),
    );

    expect(decisao).toEqual({ action: 'ok' });
  });

  it('deixa para conferir o produto com preço alterado depois da carga', () => {
    const decisao = decideUnit(
      legado(),
      produto({ items: item({ unitCost: 3500, salePrice: 3500 }) }),
    );

    expect(decisao).toEqual({
      action: 'review',
      reason: 'alterado depois da carga',
    });
  });

  it('deixa para conferir o produto que ganhou medida depois da carga', () => {
    const decisao = decideUnit(
      legado(),
      produto({ items: item({ width: 1000, height: 1000 }) }),
    );

    expect(decisao.action).toBe('review');
  });

  it('deixa para conferir o produto com mais de um item', () => {
    const [primeiro] = produto().items;
    const decisao = decideUnit(
      legado(),
      produto({ items: [primeiro, { ...primeiro, id: 'item-2' }] }),
    );

    expect(decisao.action).toBe('review');
  });

  it('não toca no produto adotado, que é cadastro da conta', () => {
    const decisao = decideUnit(legado(), produto({ isImported: false }));

    expect(decisao.action).toBe('skip');
  });

  it('não inventa unidade quando o legado não tem nenhuma', () => {
    const decisao = decideUnit(
      legado({ unidade: '', unidadeMigrada: '' }),
      produto({ items: item({ unitKind: null }) }),
    );

    expect(decisao.action).toBe('skip');
  });

  it('reconhece a hora que a carga anterior gravou como unidade', () => {
    // A carga não conhecia "HH" e gravava unidade avulsa.
    const decisao = decideUnit(
      legado({ unidade: 'HH', unidadeMigrada: 'HH', valorCentavos: 350 }),
      produto({ items: item({ unitCost: 350, salePrice: 350 }) }),
    );

    expect(decisao).toMatchObject({
      action: 'fix',
      to: { unitKind: 'DURATION', salePrice: null },
    });
  });
});

describe('kindAsMigrated', () => {
  it('reproduz o que a carga anterior gravava', () => {
    expect(kindAsMigrated('UN')).toBe('UNITY');
    expect(kindAsMigrated('M')).toBe('LENGTH');
    expect(kindAsMigrated('HH')).toBe('UNITY');
    expect(kindAsMigrated('')).toBeNull();
  });
});

describe('decideStatus', () => {
  it('inativa o produto que está inativo no legado', () => {
    // "Banner Papel A1" (BAN04) estava fora de linha e apareceu ao lado do
    // "Banner Papel" como se fosse duplicado.
    expect(decideStatus(legado({ ativo: false }), produto())).toBe(
      'deactivate',
    );
  });

  it('mantém ativo o que já foi vendido no Atrupe', () => {
    expect(
      decideStatus(legado({ ativo: false }), produto({ ownUses: 2 })),
    ).toBe('in-use');
  });

  it('não reativa nem mexe no produto adotado', () => {
    expect(decideStatus(legado(), produto({ isActive: false }))).toBe('none');
    expect(
      decideStatus(legado({ ativo: false }), produto({ isImported: false })),
    ).toBe('none');
  });
});

describe('planFixes', () => {
  it('casa pelo vínculo e, na falta dele, pelo código', () => {
    const porCodigo = new Map([
      ['ban05', legado()],
      ['ban04', legado({ codigo: 'BAN04', ativo: false, unidade: 'UN' })],
    ]);

    const plano = planFixes(porCodigo, [
      produto(),
      produto({
        id: 'prod-2',
        code: 'BAN04',
        legacyId: null,
        items: item({ unitCost: 3000, salePrice: 3000 }),
      }),
      produto({ id: 'prod-3', code: 'NOVO', legacyId: null }),
    ]);

    expect(plano.unitFixes.map((f) => f.product.id)).toEqual(['prod-1']);
    expect(plano.unitOk).toBe(1);
    expect(plano.deactivate.map((d) => d.product.id)).toEqual(['prod-2']);
    expect(plano.unmatched).toBe(1);
  });
});
