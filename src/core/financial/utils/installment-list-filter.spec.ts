import { installmentListWhere } from './installment-list-filter';

describe('installmentListWhere (filtros de Contas a receber e a pagar)', () => {
  it('sem filtro agrupa por vencimento, do mais novo ao mais antigo', () => {
    const r = installmentListWhere({} as any);
    expect(r.field).toBe('dueDate');
    expect(r.sort).toBe('desc');
    expect(r.where).toEqual({});
  });

  it('o período vale o dia inteiro nas duas pontas', () => {
    const r = installmentListWhere({
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-10-31'),
    } as any);
    const range = r.where.dueDate as { gte: Date; lte: Date };
    expect(range.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(range.lte.toISOString()).toBe('2026-10-31T23:59:59.999Z');
  });

  it('por data de pagamento, só as parcelas pagas e agrupadas pelo pagamento', () => {
    const r = installmentListWhere({ dateType: 'paidDate' } as any);
    expect(r.field).toBe('paidDate');
    expect(r.where).toEqual({ paidDate: { not: null } });
  });

  it('conta e ordem crescente', () => {
    const r = installmentListWhere({ bankAccountId: 'c1', sort: 'asc' } as any);
    expect(r.where).toEqual({ bankAccountId: 'c1' });
    expect(r.sort).toBe('asc');
  });
});
