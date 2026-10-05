import { backfillQuotationSubCompany } from './backfill-quotation-sub-company';

/**
 * O documento migrado nascia sem subempresa fiscal, e sem ela a tela não
 * salvava a edição. O script preenche com a empresa do documento, como o
 * documento nativo já faz, e precisa ser seguro para rodar de novo.
 */
describe('backfillQuotationSubCompany', () => {
  const prismaFake = (migrados: number, nativos: number) => {
    const executeRaw = jest.fn().mockResolvedValue(migrados + nativos);
    const count = jest
      .fn()
      .mockImplementation(({ where }) =>
        Promise.resolve(where.isImported ? migrados : nativos),
      );

    return {
      prisma: { quotation: { count }, $executeRaw: executeRaw } as any,
      executeRaw,
    };
  };

  it('simula por padrão', async () => {
    const { prisma, executeRaw } = prismaFake(20221, 7);

    const summary = await backfillQuotationSubCompany(prisma);

    expect(summary).toEqual({ migrados: 20221, nativos: 7, gravados: 0 });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('grava com --yes e devolve quantos mudaram', async () => {
    const { prisma, executeRaw } = prismaFake(20221, 7);

    const summary = await backfillQuotationSubCompany(prisma, { apply: true });

    expect(summary.gravados).toBe(20228);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('não grava quando não há o que preencher', async () => {
    const { prisma, executeRaw } = prismaFake(0, 0);

    const summary = await backfillQuotationSubCompany(prisma, { apply: true });

    expect(summary.gravados).toBe(0);
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
