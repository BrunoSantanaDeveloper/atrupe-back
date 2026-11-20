import { buildSaleNfce, nfcePaymentType } from './pdv-nfce';

describe('buildSaleNfce (NFC-e da frente de caixa)', () => {
  const fiscal = {
    productCode: 'ADE',
    ncm: '49119900',
    cest: null,
    cean: null,
    commercialUnit: 'UN',
    cfopInState: '5102',
    icmsCst: '102',
    pisCst: '49',
    cofinsCst: '49',
  };
  const item = (finalValue: number, quantity = 1) => ({
    productId: 'p-1',
    name: 'Adesivo',
    code: 'ADE',
    quantity,
    finalValue,
    fiscal,
  });
  const base = {
    quotationId: 'q-1',
    naturezaOperacao: 'Venda de mercadoria',
  };

  it('monta itens e pagamentos em reais, com o tPag de cada forma', () => {
    const dto = buildSaleNfce({
      ...base,
      saleTotal: 15000,
      items: [item(10000, 2), item(5000)],
      parts: [
        { method: 'CASH', amount: 5000 },
        { method: 'PIX', amount: 6000 },
        { method: 'CARD', amount: 4000, methodCode: 'DEB' },
      ],
      cpf: '123.456.789-09',
    });
    expect(dto.cpfConsumidor).toBe('12345678909');
    expect(dto.itens[0]).toMatchObject({
      quantidade: 2,
      valorUnitario: 50,
      ncm: '49119900',
      cfop: '5102',
    });
    expect(dto.pagamentos).toEqual([
      { tipo: '01', valor: 50 },
      { tipo: '17', valor: 60 },
      { tipo: '04', valor: 40 },
    ]);
    expect(dto.valorTroco).toBeUndefined();
  });

  it('centavos que não dividem pela quantidade viram desconto do item', () => {
    const dto = buildSaleNfce({
      ...base,
      saleTotal: 1000,
      items: [item(1000, 3)],
      parts: [{ method: 'PIX', amount: 1000 }],
    });
    // 3 × 3,34 = 10,02 → desconto de 0,02
    expect(dto.itens[0]).toMatchObject({
      valorUnitario: 3.34,
      valorDesconto: 0.02,
    });
  });

  it('o arredondamento no balcão entra como desconto', () => {
    const dto = buildSaleNfce({
      ...base,
      saleTotal: 9950,
      items: [item(5000), item(5000)],
      parts: [{ method: 'CASH', amount: 9950 }],
    });
    expect(dto.itens[1].valorDesconto).toBe(0.5);
  });

  it('sem a venda inteira recebida, não emite', () => {
    expect(() =>
      buildSaleNfce({
        ...base,
        saleTotal: 10000,
        items: [item(10000)],
        parts: [{ method: 'CASH', amount: 4000 }],
      }),
    ).toThrow('Receba a venda inteira antes de emitir a NFC-e');
  });

  it('CPF com outro tamanho é recusado', () => {
    expect(() =>
      buildSaleNfce({
        ...base,
        saleTotal: 100,
        items: [item(100)],
        parts: [{ method: 'CASH', amount: 100 }],
        cpf: '123',
      }),
    ).toThrow('CPF inválido');
  });

  it('cartão de crédito é 03', () => {
    expect(
      nfcePaymentType({ method: 'CARD', amount: 1, methodCode: 'CRD' }),
    ).toBe('03');
  });
});
