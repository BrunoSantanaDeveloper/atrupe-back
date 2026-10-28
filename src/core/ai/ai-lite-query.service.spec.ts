import { AiLiteQueryService } from './ai-lite-query.service';
import { AiProposalDeniedError } from './ai-quotation-draft.service';

describe('AiLiteQueryService', () => {
  const user = {
    userId: 'user-1',
    companyId: 'company-1',
    employeeId: 'employee-1',
    isAdmin: false,
  };

  function makeService(
    allow: (action: string, resource: string) => boolean = () => true,
    seesOthers = false,
  ) {
    const prisma = {
      quotation: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'q-1',
            quotationNumber: 7,
            status: 'DONE',
            client: { name: 'Clínica Sorriso' },
            seller: { name: 'Ana' },
            tag: { title: 'Quente' },
            contacts: [],
          },
        ]),
      },
      cashSession: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sessao-1' }]),
      },
      pendingSale: {
        findMany: jest.fn().mockResolvedValue([
          { kind: 'QUICK', total: 5_000, paid: 0, quotation: null },
          { kind: 'ORDER', total: 12_000, paid: 2_000, quotation: null },
        ]),
      },
    };
    const abacService = {
      hasPermission: jest.fn(async (_u, action, resource) =>
        allow(action, resource),
      ),
      canAccessOtherSellers: jest.fn().mockResolvedValue(seesOthers),
    };
    const reports = {
      getLossesByReason: jest.fn().mockResolvedValue({
        rejections: [{ id: 'r-1', reason: 'Preço', count: 3, value: 90_000 }],
        cancellations: [],
      }),
    };
    const credit = {
      clientCredit: jest.fn().mockResolvedValue({
        applies: true,
        enforcing: false,
        blockClient: false,
        limit: 100_000,
        used: 40_000,
        available: 60_000,
      }),
    };
    const drafts = {
      matchClient: jest.fn().mockResolvedValue({
        id: 'client-1',
        name: 'Clínica Sorriso',
        match: 'EXACT',
      }),
    };
    const service = new AiLiteQueryService(
      prisma as any,
      abacService as any,
      reports as any,
      {} as any,
      credit as any,
      drafts as any,
    );
    return { service, prisma, reports, credit };
  }

  it('acompanhamento do dia: só as próprias vendas de quem não vê os outros', async () => {
    const { service, prisma } = makeService();

    const result = await service.followUpToday(user);

    expect(prisma.quotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { companyId: 'company-1', sellerId: 'employee-1' },
            expect.any(Object),
          ],
        },
      }),
    );
    expect(result.due.records[0]).toEqual(
      expect.objectContaining({
        quotationNumber: 7,
        client: 'Clínica Sorriso',
        tag: 'Quente',
        lastContact: null,
      }),
    );
  });

  it('perdas por motivo sem values:values: as contagens, sem o valor', async () => {
    const { service, reports } = makeService(
      (_a, resource) => resource !== 'values:values',
    );

    const result = await service.lostReasons({ startDate: '2026-10-01' }, user);

    expect(reports.getLossesByReason).toHaveBeenCalledWith('company-1', {
      startDate: '2026-10-01',
      sellerId: 'employee-1',
    });
    expect(result.rejections).toEqual([
      { id: 'r-1', reason: 'Preço', count: 3 },
    ]);
  });

  it('fila da frente de caixa: quantas e quanto falta receber', async () => {
    const { service } = makeService();

    const result = await service.cashFrontQueue(user);

    expect(result).toEqual(
      expect.objectContaining({
        openCashFronts: 1,
        waiting: 2,
        toReceive: 15_000,
      }),
    );
  });

  it('frente de caixa sem a permissão: recusa', async () => {
    const { service } = makeService(
      (_a, resource) => resource !== 'financial:pdv',
    );

    await expect(service.cashFrontQueue(user)).rejects.toBeInstanceOf(
      AiProposalDeniedError,
    );
  });

  it('crédito do cliente pelo nome: limite, usado e disponível', async () => {
    const { service, credit } = makeService();

    const result = await service.clientCredit(
      { clientHint: 'Clínica Sorriso' },
      user,
    );

    expect(credit.clientCredit).toHaveBeenCalledWith('company-1', 'client-1');
    expect(result).toEqual(
      expect.objectContaining({
        found: true,
        client: 'Clínica Sorriso',
        limit: 100_000,
        available: 60_000,
        enforcing: false,
      }),
    );
  });

  it('crédito sem values:values: recusa (limite é valor)', async () => {
    const { service } = makeService(
      (_a, resource) => resource !== 'values:values',
    );

    await expect(
      service.clientCredit({ clientHint: 'Clínica' }, user),
    ).rejects.toBeInstanceOf(AiProposalDeniedError);
  });
});
