import { PaymentStatus } from '@prisma/client';
import { resolveTitleStatus, parcelasComPagamento } from './title-status.util';

describe('resolveTitleStatus', () => {
  const { PENDING, PAID, CANCELED, PROVISIONED } = PaymentStatus;

  it('mantem o titulo em aberto quando uma parcela e cancelada e outra segue pendente', () => {
    // A regra antiga marcava o titulo inteiro como CANCELED aqui, e a
    // cobranca das parcelas restantes sumia do relatorio financeiro.
    expect(resolveTitleStatus([CANCELED, PENDING])).toBe(PENDING);
    expect(resolveTitleStatus([PENDING, CANCELED, PENDING])).toBe(PENDING);
  });

  it('cancela o titulo so quando todas as parcelas estao canceladas', () => {
    expect(resolveTitleStatus([CANCELED])).toBe(CANCELED);
    expect(resolveTitleStatus([CANCELED, CANCELED])).toBe(CANCELED);
  });

  it('considera pago ignorando as parcelas canceladas', () => {
    expect(resolveTitleStatus([PAID, PAID])).toBe(PAID);
    expect(resolveTitleStatus([CANCELED, PAID])).toBe(PAID);
  });

  it('aponta as parcelas com pagamento registrado', () => {
    const parcelas = [
      { status: PENDING, paidAmount: 0 },
      { status: PAID, paidAmount: 5000 },
      { status: PROVISIONED, paidAmount: 0 },
      { status: CANCELED, paidAmount: 0 },
      { status: PENDING, paidAmount: 250 },
    ];

    // PAID e PROVISIONED entram pelo status; a pendente com valor baixado
    // entra pelo paidAmount - sao os casos em que cancelar sumiria com
    // dinheiro que ja esta no caixa.
    expect(parcelasComPagamento(parcelas)).toEqual([
      { status: PAID, paidAmount: 5000 },
      { status: PROVISIONED, paidAmount: 0 },
      { status: PENDING, paidAmount: 250 },
    ]);
  });

  it('nao aponta nada quando nenhuma parcela tem pagamento', () => {
    expect(
      parcelasComPagamento([
        { status: PENDING, paidAmount: 0 },
        { status: CANCELED, paidAmount: null },
      ]),
    ).toEqual([]);
    expect(parcelasComPagamento([])).toEqual([]);
    expect(parcelasComPagamento(undefined as any)).toEqual([]);
  });

  it('nao decide quando as parcelas nao determinam o status', () => {
    expect(resolveTitleStatus([PROVISIONED])).toBeNull();
    expect(resolveTitleStatus([PAID, PROVISIONED])).toBeNull();
    expect(resolveTitleStatus([])).toBeNull();
    expect(resolveTitleStatus(undefined as any)).toBeNull();
  });
});
