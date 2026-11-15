import {
  arredondar,
  totaisDosItens,
  valoresDaLinhaParaNota,
  valoresDoItemNoXml,
} from './fiscal-line-values.util';

/** Linha de O.S. sem medida: a nota conta 1 UN. Valores em centavos. */
const linha = (over = {}) => ({
  quantity: 1,
  totalValue: 10000,
  finalValue: 10000,
  items: [],
  ...over,
});

describe('valoresDaLinhaParaNota', () => {
  /**
   * Placa da GrafK (O.S. 147): PS2mm de 2,50 x 1,00 m vendida por R$ 530,00,
   * com UN no cadastro fiscal. A nota saía "2,5 M2 x R$ 212".
   */
  describe('unidade cadastrada', () => {
    const placa = linha({
      totalValue: 53000,
      finalValue: 53000,
      items: [{ quantity: 1, unitKind: 'AREA', width: 2500, height: 1000 }],
    });

    it('UN: 1 UN x R$ 530,00', () => {
      expect(valoresDaLinhaParaNota(placa, 'UN')).toEqual({
        quantity: 1,
        unit: 'UN',
        unitValue: 530,
        discount: 0,
        totalValue: 530,
        pieceQuantity: 1,
        measureQuantity: 2.5,
        measureUnit: 'M2',
      });
    });

    it('M2: 2,5 M2 x R$ 212,00', () => {
      expect(valoresDaLinhaParaNota(placa, 'M2')).toEqual({
        quantity: 2.5,
        unit: 'M2',
        unitValue: 212,
        discount: 0,
        totalValue: 530,
        pieceQuantity: 1,
        measureQuantity: 2.5,
        measureUnit: 'M2',
      });
    });

    it('linha sem medida não leva a quantidade medida', () => {
      const semMedida = valoresDaLinhaParaNota(
        linha({ items: [{ quantity: 3, unitKind: 'UNITY' }] }),
        'UN',
      );

      expect(semMedida.pieceQuantity).toBe(3);
      expect(semMedida).not.toHaveProperty('measureQuantity');
    });
  });

  /**
   * O valor unitário saía do líquido e o desconto era abatido outra vez: a
   * nota de uma venda de R$ 90,00 (R$ 100,00 com R$ 10,00 de desconto) somava
   * R$ 80,00.
   */
  describe('desconto', () => {
    it('vUnCom do bruto e o desconto uma vez só', () => {
      const valores = valoresDaLinhaParaNota(linha({ finalValue: 9000 }), 'UN');

      expect(valores).toEqual({
        quantity: 1,
        unit: 'UN',
        unitValue: 100,
        discount: 10,
        totalValue: 90,
        pieceQuantity: 1,
      });
    });

    it('desconto percentual sai da diferença, não do campo (10% não é R$ 0,10)', () => {
      // `discount` = 10 e `discountType` = PERCENT ficam no banco; a nota não
      // os lê, e o desconto é a diferença entre bruto e líquido.
      const valores = valoresDaLinhaParaNota(
        { ...linha({ finalValue: 9000 }), discount: 10 } as any,
        'UN',
      );

      expect(valores.discount).toBe(10);
      expect(valores.totalValue).toBe(90);
    });

    it('acréscimo entra no valor unitário, sem desconto negativo', () => {
      const valores = valoresDaLinhaParaNota(
        linha({ finalValue: 11000 }),
        'UN',
      );

      expect(valores).toMatchObject({
        unitValue: 110,
        discount: 0,
        totalValue: 110,
      });
    });

    it('desconto de 100% é desconto de verdade', () => {
      const valores = valoresDaLinhaParaNota(linha({ finalValue: 0 }), 'UN');

      expect(valores).toMatchObject({
        unitValue: 100,
        discount: 100,
        totalValue: 0,
      });
    });

    it('sem líquido gravado, não há desconto', () => {
      const valores = valoresDaLinhaParaNota(linha({ finalValue: null }), 'UN');

      expect(valores).toMatchObject({ discount: 0, totalValue: 100 });
    });

    it('fração de centavo do percentual vira centavo inteiro', () => {
      // 12,5% de R$ 9,99 dá 874,125 centavos de líquido.
      const valores = valoresDaLinhaParaNota(
        linha({ totalValue: 999, finalValue: 874.125 }),
        'UN',
      );

      expect(valores.discount).toBe(1.25);
      expect(valores.totalValue).toBe(8.74);
    });
  });

  describe('quantidade', () => {
    it('vai com 4 casas e o unitário sai dela', () => {
      // 1,000 x 0,123456 m = 0,123456 m², que vai ao XML como 0,1235.
      const valores = valoresDaLinhaParaNota(
        linha({
          totalValue: 100000,
          finalValue: 100000,
          items: [
            { quantity: 1, unitKind: 'AREA', width: 1000, height: 123.456 },
          ],
        }),
        'M2',
      );

      expect(valores.quantity).toBe(0.1235);
      expect(valoresDoItemNoXml(valores).valorProduto).toBe(1000);
    });

    it('medida menor que 0,001 conta as peças', () => {
      // 1 cm x 1 cm = 0,0001 m²: qCOM abaixo do mínimo da emissão.
      const valores = valoresDaLinhaParaNota(
        linha({
          totalValue: 500,
          finalValue: 500,
          items: [{ quantity: 3, unitKind: 'AREA', width: 10, height: 10 }],
        }),
        'M2',
      );

      expect(valores).toMatchObject({ quantity: 3, unit: 'UN' });
    });
  });

  it('o item da nota fecha com o líquido da linha', () => {
    const casos = [
      linha({ totalValue: 10000, finalValue: 3333 }),
      linha({
        totalValue: 14600,
        finalValue: 13140,
        items: [{ quantity: 2, unitKind: 'AREA', width: 1150, height: 530 }],
      }),
      linha({ quantity: 3, totalValue: 10000, finalValue: 10000 }),
    ];

    for (const caso of casos) {
      for (const unidade of ['UN', 'M2']) {
        const valores = valoresDaLinhaParaNota(caso, unidade);
        const noXml = valoresDoItemNoXml(valores);
        expect(arredondar(noXml.valorProduto - noXml.desconto, 2)).toBe(
          valores.totalValue,
        );
      }
    }
  });
});

describe('valoresDoItemNoXml e totaisDosItens', () => {
  it('vProd sai da quantidade de 4 casas que vai em qCOM', () => {
    expect(
      valoresDoItemNoXml({ quantity: 2.12345, unitValue: 10, discount: 0 }),
    ).toEqual({
      quantidade: 2.1235,
      valorProduto: 21.24,
      desconto: 0,
      frete: 0,
      seguro: 0,
    });
  });

  it('os totais somam os itens já arredondados', () => {
    // Três itens de 1/3: cada vProd é 0,33 e o total precisa ser 0,99, e não
    // 1,00 — a SEFAZ confere o total com a soma dos itens.
    const terco = { quantity: 1, unitValue: 1 / 3, discount: 0 };

    expect(totaisDosItens([terco, terco, terco])).toEqual({
      valorProdutos: 0.99,
      valorDesconto: 0,
      valorFrete: 0,
      valorSeguro: 0,
      valorTotal: 0.99,
    });
  });

  /**
   * Frete e seguro do item entravam no total da tela e na base do ICMS, mas
   * não no XML: a nota saía sem eles.
   */
  it('o total soma o frete e o seguro dos itens', () => {
    expect(
      totaisDosItens([
        { quantity: 1, unitValue: 100, discount: 10, freight: 20 },
        { quantity: 1, unitValue: 50, insurance: 5.5 },
      ]),
    ).toEqual({
      valorProdutos: 150,
      valorDesconto: 10,
      valorFrete: 20,
      valorSeguro: 5.5,
      valorTotal: 165.5,
    });
  });

  it('o total da nota é produtos menos descontos', () => {
    expect(
      totaisDosItens([
        { quantity: 1, unitValue: 100, discount: 10 },
        { quantity: 2, unitValue: 50, discount: null },
      ]),
    ).toEqual({
      valorProdutos: 200,
      valorDesconto: 10,
      valorFrete: 0,
      valorSeguro: 0,
      valorTotal: 190,
    });
  });
});

describe('arredondar', () => {
  it('arredonda meio para cima sem o ruído binário', () => {
    expect(arredondar(1.005, 2)).toBe(1.01);
    expect(arredondar(2.12345, 4)).toBe(2.1235);
    expect(arredondar(8.74125, 2)).toBe(8.74);
  });
});
