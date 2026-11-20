import { PdvService } from './pdv.service';

/**
 * Quem abre cada frente de caixa (Lista Lite 19/11, item 2): a lista de
 * usuários da frente; vazia, todos com a permissão; o administrador passa.
 */
describe('PdvService.openSession: usuários da frente', () => {
  const actor = { id: 'u1', name: 'Léo' } as any;
  const front = (id: string, userIds: string[] = [], extra = {}) => ({
    id,
    name: id,
    userIds,
    isDefault: false,
    blindCount: false,
    shortageTolerance: null,
    roundingType: 'VALUE',
    roundingLimit: 100,
    drawerAccountId: null,
    ...extra,
  });

  function setup(fronts: any[], busy: { cashFrontId: string }[] = []) {
    const prisma = {
      cashSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue(
          busy.map((row) => ({
            ...row,
            operatorName: 'Outro',
            openedAt: new Date(),
          })),
        ),
        aggregate: jest.fn().mockResolvedValue({ _max: { number: 3 } }),
        create: jest.fn(async ({ data }) => ({
          ...data,
          id: 's-1',
          status: 'OPEN',
          openedAt: new Date(),
          cashFront: fronts.find((item) => item.id === data.cashFrontId),
          movements: [],
        })),
      },
      cashFront: {
        findMany: jest.fn().mockResolvedValue(fronts),
        create: jest.fn(),
      },
      bankAccount: { findFirst: jest.fn(), update: jest.fn() },
    };
    const service = new PdvService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  }

  it('abre a frente liberada para o usuário, pulando a de outro', async () => {
    const { service, prisma } = setup([
      front('caixa-1', ['u2']),
      front('caixa-2', ['u1']),
    ]);
    await service
      .openSession(
        { userId: 'u1', companyId: 'e' } as any,
        { openingBalance: 0 } as any,
        actor,
      )
      .catch(() => undefined);
    expect(prisma.cashSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cashFrontId: 'caixa-2' }),
      }),
    );
  });

  it('recusa abrir a frente de outro usuário', async () => {
    const { service } = setup([front('caixa-1', ['u2'])]);
    await expect(
      service.openSession(
        { userId: 'u1', companyId: 'e' } as any,
        { openingBalance: 0, cashFrontId: 'caixa-1' } as any,
        actor,
      ),
    ).rejects.toThrow('Esta frente de caixa não está liberada para você');
  });

  it('sem nenhuma frente liberada, diz com quem falar', async () => {
    const { service } = setup([front('caixa-1', ['u2'])]);
    await expect(
      service.openSession(
        { userId: 'u1', companyId: 'e' } as any,
        { openingBalance: 0 } as any,
        actor,
      ),
    ).rejects.toThrow('Nenhuma frente de caixa está liberada para você');
  });

  it('com as liberadas ocupadas, não cria uma frente nova', async () => {
    const { service, prisma } = setup(
      [front('caixa-1', ['u1']), front('caixa-2', ['u2'])],
      [{ cashFrontId: 'caixa-1' }],
    );
    await expect(
      service.openSession(
        { userId: 'u1', companyId: 'e' } as any,
        { openingBalance: 0 } as any,
        actor,
      ),
    ).rejects.toThrow(
      'As frentes de caixa liberadas para você já estão abertas',
    );
    expect(prisma.cashFront.create).not.toHaveBeenCalled();
  });

  it('o administrador abre qualquer frente', async () => {
    const { service } = setup([front('caixa-1', ['u2'])]);
    await expect(
      service.openSession(
        { userId: 'u1', companyId: 'e', isAdmin: true } as any,
        { openingBalance: 0, cashFrontId: 'caixa-1' } as any,
        actor,
      ),
    ).resolves.toBeDefined();
  });
});
