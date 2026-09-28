import { readLegacySaleDates, targetDates } from './fix-legacy-document-dates';

/**
 * As cargas anteriores gravavam o documento com o instante da migração. Este
 * script reescreve as datas a partir da venda no legado, e precisa ser seguro
 * para rodar de novo: nada muda no que já está certo.
 */
describe('targetDates', () => {
  const venda = {
    legacyId: '10',
    createdAt: '2024-05-10',
    approvedAt: '',
  };

  const orcamento = (over: any = {}) => ({
    status: 'OPEN',
    createdAt: new Date('2026-09-18T14:32:00.000Z'),
    approvedAt: null,
    ...over,
  });

  it('devolve a data da venda ao meio-dia UTC', () => {
    // Meia-noite UTC apareceria como o dia 9 às 21h no fuso do Brasil.
    expect(targetDates(venda, orcamento())?.createdAt.toISOString()).toBe(
      '2024-05-10T12:00:00.000Z',
    );
  });

  it('só preenche a aprovação em documento aprovado', () => {
    expect(targetDates(venda, orcamento())?.approvedAt).toBeNull();
    expect(
      targetDates(venda, orcamento({ status: 'APPROVED' }))?.approvedAt,
    ).toEqual(new Date('2024-05-10T12:00:00.000Z'));
  });

  it('usa a data de aprovação do legado quando existe', () => {
    const aprovadaDepois = { ...venda, approvedAt: '2024-05-14' };

    expect(
      targetDates(aprovadaDepois, orcamento({ status: 'DONE' }))?.approvedAt,
    ).toEqual(new Date('2024-05-14T12:00:00.000Z'));
  });

  it('não mexe no documento que já está com a data certa', () => {
    expect(
      targetDates(
        venda,
        orcamento({ createdAt: new Date('2024-05-10T12:00:00.000Z') }),
      ),
    ).toBeNull();
  });

  it('corrige o documento aprovado que está sem data de aprovação', () => {
    const certo = orcamento({
      status: 'APPROVED',
      createdAt: new Date('2024-05-10T12:00:00.000Z'),
      approvedAt: null,
    });

    expect(targetDates(venda, certo)?.approvedAt).toEqual(
      new Date('2024-05-10T12:00:00.000Z'),
    );
  });

  it('ignora a venda sem data no legado', () => {
    expect(targetDates({ ...venda, createdAt: '' }, orcamento())).toBeNull();
  });
});

describe('readLegacySaleDates', () => {
  it('indexa por código da venda e descarta a data sentinela de 1899', async () => {
    const legacy = {
      query: jest.fn().mockResolvedValue([
        [
          {
            legacyId: 10,
            createdAt: '2024-05-10T03:00:00.000Z',
            approvedAt: '1899-11-30T03:06:28.000Z',
          },
          { legacyId: null, createdAt: '2024-01-01', approvedAt: '' },
        ],
      ]),
    } as any;

    const vendas = await readLegacySaleDates(legacy, 'acn_000320');

    expect(vendas.get('10')).toEqual({
      legacyId: '10',
      createdAt: '2024-05-10',
      approvedAt: '',
    });
    expect(vendas.size).toBe(1);
    expect(legacy.query.mock.calls[0][0]).toContain('acn_000320.sales_venda');
  });
});
