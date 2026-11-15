import {
  agruparHistorico,
  comoOBotaoDeixou,
  precosDoItem,
  proporPreco,
  reaisEmCentavos,
  ItemDoProduto,
} from './repair-nfe-saved-product-prices';

const dia = (iso: string) => new Date(`${iso}T12:00:00Z`);

const item = (over: Partial<ItemDoProduto> = {}): ItemDoProduto => ({
  id: 'item-1',
  unitKind: 'AREA',
  unitCost: 530,
  salePrice: 530,
  width: null,
  height: null,
  duration: null,
  ...over,
});

describe('agruparHistorico', () => {
  it('junta taxas que só diferem no ruído e ordena pelo mais usado', () => {
    const grupos = agruparHistorico(
      [
        { unitCost: 0.023, createdAt: dia('2026-11-10') },
        { unitCost: 0.02300014, createdAt: dia('2026-09-18') },
        { unitCost: 0.04666667, createdAt: dia('2026-09-18') },
      ],
      'AREA',
    );

    expect(grupos[0]).toEqual({
      centavos: 23000,
      linhas: 2,
      ultima: dia('2026-11-10'),
    });
    expect(grupos[1].centavos).toBe(46667);
  });

  it('no empate, o preço mais recente vem primeiro', () => {
    const grupos = agruparHistorico(
      [
        { unitCost: 2510, createdAt: dia('2026-10-16') },
        { unitCost: 2835, createdAt: dia('2026-11-10') },
      ],
      'UNITY',
    );

    expect(grupos.map((g) => g.centavos)).toEqual([2835, 2510]);
  });
});

describe('proporPreco', () => {
  it('valor digitado que é preço do histórico: só a escala estava errada', () => {
    // Banner do Armazém 76: R$ 80 por m² digitado e gravado como taxa.
    const proposta = proporPreco(80, [
      { centavos: 8000, linhas: 2, ultima: dia('2026-08-18') },
      { centavos: 110880, linhas: 1, ultima: dia('2026-11-10') },
    ]);

    expect(proposta).toMatchObject({ centavos: 8000, confianca: 'alta' });
  });

  it('preço que domina as O.S. é proposta de confiança alta', () => {
    // PS2mm da GrafK: R$ 200/m² em 14 linhas.
    const proposta = proporPreco(530, [
      { centavos: 20000, linhas: 14, ultima: dia('2026-10-06') },
      { centavos: 22222, linhas: 7, ultima: dia('2026-10-22') },
    ]);

    expect(proposta).toMatchObject({ centavos: 20000, confianca: 'alta' });
  });

  it('histórico dividido fica para o cliente decidir', () => {
    const proposta = proporPreco(750, [
      { centavos: 2510, linhas: 2, ultima: dia('2026-10-16') },
      { centavos: 2835, linhas: 1, ultima: dia('2026-11-10') },
    ]);

    expect(proposta).toMatchObject({ centavos: 2510, confianca: 'baixa' });
  });

  it('sem O.S. não há proposta', () => {
    expect(proporPreco(2, [])).toMatchObject({
      centavos: null,
      confianca: 'sem-historico',
    });
  });
});

describe('comoOBotaoDeixou', () => {
  it('custo e preço iguais: como o botão gravou', () => {
    expect(comoOBotaoDeixou(item())).toBe(true);
  });

  it('área gravada pela tela tem preço = taxa x medida', () => {
    expect(
      comoOBotaoDeixou(
        item({ unitCost: 0.055, salePrice: 55000, width: 1000, height: 1000 }),
      ),
    ).toBe(false);
  });

  it('item sem preço não é estrago a desfazer', () => {
    expect(comoOBotaoDeixou(item({ unitCost: null, salePrice: null }))).toBe(
      false,
    );
  });
});

describe('precosDoItem', () => {
  it('área com medida padrão: taxa por mm² e preço da peça', () => {
    expect(precosDoItem(item({ width: 1000, height: 1000 }), 12000)).toEqual({
      unitCost: 0.012,
      salePrice: 12000,
    });
  });

  it('área sem medida padrão: só a taxa', () => {
    expect(precosDoItem(item(), 20000)).toEqual({
      unitCost: 0.02,
      salePrice: null,
    });
  });

  it('unidade: o preço da peça nos dois campos', () => {
    expect(precosDoItem(item({ unitKind: 'UNITY' }), 2200)).toEqual({
      unitCost: 2200,
      salePrice: 2200,
    });
  });
});

describe('reaisEmCentavos', () => {
  it('aceita reais com vírgula e milhar', () => {
    expect(reaisEmCentavos('120')).toBe(12000);
    expect(reaisEmCentavos('120,50')).toBe(12050);
    expect(reaisEmCentavos('1.234,56')).toBe(123456);
  });

  it('recusa o que não é valor', () => {
    expect(reaisEmCentavos('abc')).toBeNull();
    expect(reaisEmCentavos('12,345')).toBeNull();
  });
});
