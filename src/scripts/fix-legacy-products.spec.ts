import {
  LegacyProduct,
  LineSnapshot,
  ProductSnapshot,
  decideExample,
  decideLine,
  decideStatus,
  decideUnit,
  kindAsMigrated,
  planExamples,
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
  descricao: '',
  setor: 'Almoxarifado',
  grupo: 'IMPRESSÃO DIGITAL',
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
  isStandard: false,
  isActive: true,
  ownUses: 0,
  fiscalNcm: '49119900',
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

/**
 * Exemplos de uma conta criada para a migração. Na Terabyte, o "Banner" de
 * exemplo (código trocado para BANNER, por isso sem `isStandard`) foi adotado
 * pelo "Banner" do legado, inativo lá; e o exemplo "Adesivo Recorte" ocupava
 * o código ADREC do "Adesivo Jateado + Recortes", ativo no legado.
 */
describe('decideExample', () => {
  const exemplo = (over: Partial<ProductSnapshot> = {}) =>
    produto({
      id: 'ex-1',
      code: 'BANNER',
      name: 'Banner',
      legacyId: 'BANNE',
      isImported: false,
      isStandard: false,
      fiscalNcm: '00000000',
      items: item({ unitKind: 'AREA', unitCost: 0.01, salePrice: 10000 }),
      ...over,
    });

  it('o exemplo adotado vira o produto do legado, na situação de lá', () => {
    const decisao = decideExample(
      exemplo(),
      legado({ codigo: 'BANNE', nome: 'Banner', ativo: false }),
    );

    expect(decisao).toMatchObject({ action: 'convert', active: false });
  });

  it('o exemplo que ocupava o código vira o produto ativo do legado', () => {
    const decisao = decideExample(
      exemplo({
        code: 'ADREC',
        name: 'Adesivo Recorte',
        legacyId: null,
        isStandard: true,
      }),
      legado({ codigo: 'ADREC', nome: 'Adesivo Jateado + Recortes' }),
    );

    expect(decisao).toMatchObject({ action: 'convert', active: true });
  });

  it('mantém ativo o exemplo já vendido no Atrupe', () => {
    const decisao = decideExample(
      exemplo({ ownUses: 1 }),
      legado({ codigo: 'BANNE', ativo: false }),
    );

    expect(decisao).toMatchObject({ action: 'convert', active: true });
  });

  it('inativa o exemplo que não corresponde a nada do legado', () => {
    const solto = exemplo({
      code: 'PNFLT',
      name: 'Painel Front Light',
      legacyId: null,
      isStandard: true,
    });

    expect(decideExample(solto, undefined)).toEqual({ action: 'deactivate' });
    expect(decideExample({ ...solto, ownUses: 2 }, undefined)).toEqual({
      action: 'in-use',
    });
    expect(decideExample({ ...solto, isActive: false }, undefined)).toEqual({
      action: 'none',
    });
  });

  it('não converte quando outro produto já tem o vínculo com o legado', () => {
    expect(decideExample(exemplo(), legado({ codigo: 'BANNE' }), true)).toEqual(
      { action: 'deactivate' },
    );
  });

  it('não toca no que não é exemplo nem no que a migração criou', () => {
    expect(
      decideExample(
        produto({ isImported: false, name: 'Placa do cliente', code: 'PLC' }),
        undefined,
      ),
    ).toEqual({ action: 'none' });
    expect(decideExample(produto(), legado())).toEqual({ action: 'none' });
  });
});

describe('planExamples', () => {
  it('não repete o vínculo de um produto do legado que já existe', () => {
    const porCodigo = new Map([['banne', legado({ codigo: 'BANNE' })]]);
    // O exemplo ocupa o código, mas uma carga anterior já criou o produto
    // do legado com o vínculo: converter estouraria a chave do vínculo.
    const exemplo = produto({
      id: 'ex-1',
      code: 'BANNE',
      name: 'Banner',
      legacyId: null,
      isImported: false,
      isStandard: true,
    });
    const migrado = produto({ id: 'prod-9', legacyId: 'BANNE' });

    const plano = planExamples(porCodigo, [exemplo], [migrado]);

    expect(plano.convert).toEqual([]);
    expect(plano.deactivate.map((p) => p.id)).toEqual(['ex-1']);
  });

  it('converte o exemplo cujo vínculo ninguém mais tem', () => {
    const porCodigo = new Map([['adrec', legado({ codigo: 'ADREC' })]]);
    const exemplo = produto({
      id: 'ex-2',
      code: 'ADREC',
      name: 'Adesivo Recorte',
      legacyId: null,
      isImported: false,
      isStandard: true,
    });

    const plano = planExamples(porCodigo, [exemplo], []);

    expect(plano.convert.map((c) => c.product.id)).toEqual(['ex-2']);
  });
});

/**
 * Linhas de documento migrado. Na Terabyte, o "BANNER" (BAN06) tem 330 linhas
 * vendidas com largura e comprimento que entraram como unidade.
 */
describe('decideLine', () => {
  // 2 peças de 1,00 × 0,50 m a R$ 60,00/m² = R$ 60,00.
  const linha = (over: Partial<LineSnapshot> = {}): LineSnapshot => ({
    id: 'linha-1',
    productId: 'prod-1',
    unitKind: 'UNITY',
    unitCost: 3000,
    salePrice: 6000,
    totalValue: 6000,
    width: 1000,
    height: 500,
    quantity: 1,
    lineQuantity: 2,
    ...over,
  });

  it('passa a área a linha do produto por m², mantendo o total', () => {
    const decisao = decideLine('AREA', linha());

    expect(decisao.action).toBe('fix');
    if (decisao.action !== 'fix') return;
    expect(decisao.to.unitKind).toBe('AREA');
    // A tela multiplica a taxa pela área e pela quantidade da linha.
    expect(decisao.to.unitCost * 1000 * 500 * 2).toBeCloseTo(6000, 6);
  });

  it('dá unidade à linha de O.S. que a carga gravou sem nenhuma', () => {
    expect(decideLine('UNITY', linha({ unitKind: null }))).toEqual({
      action: 'fix',
      to: { unitKind: 'UNITY', unitCost: 3000 },
    });
  });

  it('corrige a linha de O.S. sem unidade que já tinha a taxa por mm²', () => {
    // Produto de exemplo adotado já estava em área: a taxa veio por mm², mas
    // a O.S. ficou sem a unidade.
    const decisao = decideLine(
      'AREA',
      linha({ unitKind: null, unitCost: 6000 / (1000 * 500 * 2) }),
    );

    expect(decisao).toMatchObject({ action: 'fix', to: { unitKind: 'AREA' } });
  });

  it('não mexe na linha que alguém abriu e salvou', () => {
    expect(decideLine('AREA', linha({ unitCost: 2500 }))).toEqual({
      action: 'review',
    });
    expect(decideLine('AREA', linha({ quantity: 2 }))).toEqual({
      action: 'review',
    });
    expect(decideLine('AREA', linha({ totalValue: 5000 }))).toEqual({
      action: 'review',
    });
  });

  it('deixa como está a linha sem medida e a que já está certa', () => {
    expect(decideLine('AREA', linha({ width: null }))).toEqual({
      action: 'skip',
    });
    expect(decideLine('AREA', linha({ unitKind: 'AREA' }))).toEqual({
      action: 'ok',
    });
    expect(decideLine('LENGTH', linha())).toEqual({ action: 'skip' });
  });

  it('só dá unidade à linha que estava sem nenhuma', () => {
    expect(decideLine('UNITY', linha({ unitKind: 'LENGTH' }))).toEqual({
      action: 'review',
    });
  });
});

describe('decideLine no formato da tela', () => {
  it('reconhece a linha com a quantidade na composição', () => {
    // Depois da normalização: linha = 1, composição = 2. A taxa é a mesma.
    const decisao = decideLine('AREA', {
      id: 'linha-1',
      productId: 'prod-1',
      unitKind: 'UNITY',
      unitCost: 3000,
      salePrice: 6000,
      totalValue: 6000,
      width: 1000,
      height: 500,
      quantity: 2,
      lineQuantity: 1,
    });

    expect(decisao.action).toBe('fix');
    if (decisao.action !== 'fix') return;
    expect(decisao.to.unitCost * 1000 * 500 * 2).toBeCloseTo(6000, 6);
  });
});
