import { saleTotalCents } from './quick-sale.rules';

// Os valores do orçamento já vêm em centavos: o total da venda rápida é a
// soma deles, sem multiplicar por 100 (o "Cobrar" recusava toda venda)
describe('saleTotalCents', () => {
  it('soma os itens em centavos, sem multiplicar por 100', () => {
    expect(saleTotalCents({ totalValue: 5000 })).toBe(5000);
  });

  it('desconto no item já vem no totalValue', () => {
    expect(saleTotalCents({ totalValue: 4750 })).toBe(4750);
  });

  it('soma a entrega, tira o desconto das condições e soma a comissão ADD', () => {
    expect(
      saleTotalCents({
        totalValue: 10000,
        deliveryInfo: { value: 1500 },
        quotationPayment: {
          discountTotal: 500,
          commission: { type: 'ADD', totalCommission: 250 },
        },
      }),
    ).toBe(11250);
  });

  it('comissão que não é ADD não entra', () => {
    expect(
      saleTotalCents({
        totalValue: 10000,
        quotationPayment: {
          commission: { type: 'INCLUDED', totalCommission: 250 },
        },
      }),
    ).toBe(10000);
  });

  it('nunca fica negativo', () => {
    expect(
      saleTotalCents({
        totalValue: 100,
        quotationPayment: { discountTotal: 500 },
      }),
    ).toBe(0);
  });
});
