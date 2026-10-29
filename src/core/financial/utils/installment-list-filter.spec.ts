import {
  installmentListWhere,
  pageInstallmentDays,
} from './installment-list-filter';

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

  it('por data de pagamento, como no Fluxo: as pagas e as provisionadas', () => {
    const r = installmentListWhere({ dateType: 'paidDate' } as any);
    expect(r.field).toBe('paidDate');
    expect(r.where).toEqual({
      AND: [
        {
          OR: [{ provisionDate: { not: null } }, { paidDate: { not: null } }],
        },
      ],
    });
  });

  it('o período da visão por pagamento vale pelo provisionDate, senão pelo paidDate', () => {
    const r = installmentListWhere({
      dateType: 'paidDate',
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-10-31'),
    } as any);
    const range = {
      gte: new Date('2026-10-01T00:00:00.000Z'),
      lte: new Date('2026-10-31T23:59:59.999Z'),
    };
    expect(r.where).toEqual({
      AND: [
        {
          OR: [
            { provisionDate: range },
            { provisionDate: null, paidDate: range },
          ],
        },
      ],
    });
  });

  it('conta e ordem crescente', () => {
    const r = installmentListWhere({ bankAccountId: 'c1', sort: 'asc' } as any);
    expect(r.where).toEqual({ bankAccountId: 'c1' });
    expect(r.sort).toBe('asc');
  });
});

describe('pageInstallmentDays (a página da lista é de dias)', () => {
  const row = (
    id: string,
    dates: { due?: string; paid?: string; provision?: string },
  ) => ({
    id,
    dueDate: new Date(dates.due ?? '2026-10-01T03:00:00.000Z'),
    paidDate: dates.paid ? new Date(dates.paid) : null,
    provisionDate: dates.provision ? new Date(dates.provision) : null,
  });

  it('o pagamento gravado com hora cai no dia dele, não num grupo só seu', () => {
    const { total, days } = pageInstallmentDays(
      [
        row('a', { paid: '2026-10-28T03:00:00.000Z' }),
        row('b', { paid: '2026-10-28T11:41:43.089Z' }),
        row('c', { paid: '2026-10-29T03:00:00.000Z' }),
      ],
      'paidDate',
      'desc',
      1,
      10,
    );
    expect(total).toBe(2);
    expect(days.map((day) => day.ids)).toEqual([['c'], ['a', 'b']]);
    // A data do grupo é a da parcela, como gravada (a tela mostra o dia dela)
    expect(days[1].date.toISOString()).toBe('2026-10-28T03:00:00.000Z');
  });

  it('a provisionada entra pelo provisionDate, e a compensada também', () => {
    const { days } = pageInstallmentDays(
      [
        row('provisionada', { provision: '2026-10-20T03:00:00.000Z' }),
        row('compensada', {
          provision: '2026-10-20T03:00:00.000Z',
          paid: '2026-10-25T03:00:00.000Z',
        }),
      ],
      'paidDate',
      'asc',
      1,
      10,
    );
    expect(days).toHaveLength(1);
    expect(days[0].ids).toEqual(['provisionada', 'compensada']);
  });

  it('pagina os dias na ordem pedida e conta todos', () => {
    const rows = ['01', '02', '03', '04', '05'].map((d) =>
      row(d, { due: `2026-10-${d}T03:00:00.000Z` }),
    );
    const { total, days } = pageInstallmentDays(rows, 'dueDate', 'asc', 2, 2);
    expect(total).toBe(5);
    expect(days.map((day) => day.ids)).toEqual([['03'], ['04']]);
  });
});
