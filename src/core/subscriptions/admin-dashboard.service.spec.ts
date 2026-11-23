import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  AccountListQuery,
  AdminDashboardService,
} from './admin-dashboard.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { ACCOUNT_SUBSCRIPTION_WHERE } from './account-subscription';

describe('AdminDashboardService', () => {
  let service: AdminDashboardService;

  const mockPrismaService = {
    mailVerification: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    subscription: {
      findMany: jest.fn(),
    },
    company: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    userActivity: {
      findFirst: jest.fn(),
      groupBy: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    payment: {
      findMany: jest.fn(),
    },
    feature: {
      findMany: jest.fn(),
    },
    address: {
      findMany: jest.fn(),
    },
    subscriptionHistory: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminDashboardService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AdminDashboardService>(AdminDashboardService);
    jest.resetAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── listIncompleteRegistrations ───────────────────────────────────────

  describe('listIncompleteRegistrations', () => {
    it('should return paginated results grouped by date', async () => {
      const mockVerifications = [
        {
          id: 'abcd1234-test',
          companyName: 'Test Co',
          name: 'John',
          phone: '11999999999',
          email: 'john@test.com',
          createdAt: new Date('2026-01-15T10:00:00Z'),
          verified: true,
        },
      ];
      mockPrismaService.mailVerification.findMany.mockResolvedValue(
        mockVerifications,
      );
      mockPrismaService.mailVerification.count.mockResolvedValue(1);

      const result = await service.listIncompleteRegistrations(1, 10);

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].date).toBe('2026-01-15');
      expect(result.data[0].data[0].code).toBe('ABCD');
    });

    it('should return empty when no registrations', async () => {
      mockPrismaService.mailVerification.findMany.mockResolvedValue([]);
      mockPrismaService.mailVerification.count.mockResolvedValue(0);

      const result = await service.listIncompleteRegistrations();

      expect(result.total).toBe(0);
      expect(result.data).toHaveLength(0);
    });

    it('should apply search filter', async () => {
      mockPrismaService.mailVerification.findMany.mockResolvedValue([]);
      mockPrismaService.mailVerification.count.mockResolvedValue(0);

      await service.listIncompleteRegistrations(1, 10, 'name', 'test');

      expect(mockPrismaService.mailVerification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.any(Object) }),
            ]),
          }),
        }),
      );
    });
  });

  // ─── getTrialTotals ────────────────────────────────────────────────────

  describe('getTrialTotals', () => {
    it('should return correct trial counts', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 5);
      const past = new Date();
      past.setDate(past.getDate() - 3);

      // Active trials
      mockPrismaService.subscription.findMany
        .mockResolvedValueOnce([
          // ACTIVE trials
          { id: 'sub-1', companyId: 'c1', nextDueDate: future }, // ativa
          { id: 'sub-2', companyId: 'c2', nextDueDate: past }, // inativa (vencida)
        ])
        .mockResolvedValueOnce([
          // INACTIVE trials
          { id: 'sub-3', companyId: 'c3' },
        ])
        .mockResolvedValueOnce([]); // Companies with active sub (for discarded check)
      // Nenhuma delas contratou e espera o pagamento.
      mockPrismaService.company.findMany.mockResolvedValue([]);

      const result = await service.getTrialTotals();

      expect(result.data.ACTIVE).toBe(1);
      expect(result.data.INACTIVE).toBe(1);
      expect(result.data.DISCARDED).toBe(1);
      expect(result.data.TOTAL).toBe(3);
    });

    it('conta trial que contratou e não pagou sai dos testes: está em Aguardando pagamento', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 5);

      mockPrismaService.subscription.findMany
        .mockResolvedValueOnce([
          { id: 'sub-1', companyId: 'c1', nextDueDate: future },
          { id: 'sub-2', companyId: 'c2', nextDueDate: future },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockPrismaService.company.findMany.mockResolvedValue([{ id: 'c2' }]);

      const result = await service.getTrialTotals();

      expect(result.data.ACTIVE).toBe(1);
      expect(result.data.TOTAL).toBe(1);
      expect(mockPrismaService.company.findMany).toHaveBeenCalledWith({
        where: {
          AND: [
            { id: { in: ['c1', 'c2'] } },
            expect.objectContaining({ blockLevel: 'NONE' }),
          ],
        },
        select: { id: true },
      });
    });
  });

  // ─── getActiveTotals ──────────────────────────────────────────────────

  describe('getActiveTotals', () => {
    it('should return all status counts', async () => {
      mockPrismaService.company.count
        .mockResolvedValueOnce(10) // active
        .mockResolvedValueOnce(2) // blocked
        .mockResolvedValueOnce(4) // awaiting payment
        .mockResolvedValueOnce(3) // inactive
        .mockResolvedValueOnce(1); // canceled

      const result = await service.getActiveTotals();

      expect(result.data).toEqual({
        ACTIVE: 10,
        BLOCKED: 2,
        AWAITING_PAYMENT: 4,
        INACTIVE: 3,
        CANCELED: 1,
        TOTAL: 20,
      });
    });

    it('contratação à espera do pagamento tem aba própria, fora de Inativas e Canceladas', async () => {
      mockPrismaService.company.count.mockResolvedValue(0);

      await service.getActiveTotals();

      const where = (n: number) =>
        mockPrismaService.company.count.mock.calls[n - 1][0].where;
      const awaiting = {
        AND: [
          ACCOUNT_SUBSCRIPTION_WHERE,
          expect.objectContaining({
            status: 'INACTIVE',
            contractedAt: { not: null },
            endedReason: null,
          }),
        ],
      };
      expect(where(3)).toEqual({
        blockLevel: 'NONE',
        Subscription: {
          some: awaiting,
          none: { AND: [ACCOUNT_SUBSCRIPTION_WHERE, { status: 'ACTIVE' }] },
        },
      });
      // Inativas (sem bloqueio) e Canceladas não levam quem aguarda o pagamento.
      expect(where(4).OR[1].Subscription.none.OR).toContainEqual(awaiting);
      expect(where(5).Subscription.none.OR).toContainEqual(awaiting);
    });

    it('não conta contratação que não chegou ao fim', async () => {
      mockPrismaService.company.count.mockResolvedValue(0);

      await service.getActiveTotals();

      expect(mockPrismaService.company.count).toHaveBeenNthCalledWith(1, {
        where: {
          blockLevel: 'NONE',
          Subscription: {
            some: { AND: [ACCOUNT_SUBSCRIPTION_WHERE, { status: 'ACTIVE' }] },
          },
        },
      });
    });
  });

  // ─── getCompanyHistory ─────────────────────────────────────────────────

  describe('getCompanyHistory', () => {
    it('should throw NotFoundException when company not found', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue(null);

      await expect(service.getCompanyHistory('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return history with merged subscription and payment events', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Test',
        isActive: true,
        Subscription: [
          {
            plan: { name: 'START' },
            history: [
              {
                id: 'h1',
                action: 'CREATED',
                description: 'Sub created',
                createdAt: new Date('2026-01-10'),
                metadata: {},
              },
            ],
            payments: [
              {
                id: 'p1',
                status: 'RECEIVED',
                asaasPaymentId: 'pay_1',
                value: 99,
                billingType: 'CREDIT_CARD',
                dueDate: new Date('2026-01-15'),
                confirmedDate: new Date('2026-01-15'),
                paymentDate: new Date('2026-01-15'),
                invoiceUrl: 'https://invoice.url',
                createdAt: new Date('2026-01-15'),
              },
            ],
          },
        ],
      });
      mockPrismaService.userActivity.findFirst.mockResolvedValue({
        lastActive: new Date(),
        user: { name: 'Admin', email: 'admin@test.com' },
        ipAddress: '127.0.0.1',
      });

      const result = await service.getCompanyHistory('company-1');

      expect(result.data).toHaveLength(2); // 1 history + 1 payment
      // Sorted by date desc — payment (Jan 15) comes before history (Jan 10)
      expect(result.data[0].action).toBe('PAYMENT_RECEIVED');
      expect(result.data[1].action).toBe('CREATED');
      expect(result.lastAccess).toBeDefined();
      expect(result.company.name).toBe('Test');
    });

    it('should return null lastAccess when no activity found', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Test',
        isActive: true,
        Subscription: [],
      });
      mockPrismaService.userActivity.findFirst.mockResolvedValue(null);

      const result = await service.getCompanyHistory('company-1');

      expect(result.lastAccess).toBeNull();
      expect(result.data).toHaveLength(0);
    });
  });

  // ─── listActiveClients ─────────────────────────────────────────────────

  describe('listActiveClients', () => {
    const PAST = new Date('2020-01-10T12:00:00Z');
    const FUTURE = new Date('2099-01-10T12:00:00Z');

    const subscription = (overrides: Record<string, unknown> = {}) => ({
      id: 'sub-1',
      createdAt: new Date('2026-01-15T12:00:00Z'),
      nextDueDate: new Date('2026-02-15T12:00:00Z'),
      contractedAt: new Date('2026-01-15T12:00:00Z'),
      status: 'ACTIVE',
      cycle: 'MONTHLY',
      billingType: 'CREDIT_CARD',
      billingMode: null,
      asaasSubscriptionId: 'sub_abc',
      installmentCount: null,
      couponCode: null,
      value: 307,
      additionalUsers: 2,
      plan: {
        name: 'Start',
        planType: 'START',
        additionalUserPrice: 1500,
        planLimits: [{ value: 3 }],
      },
      subscriptionFeatures: [
        {
          price: 7000,
          createdAt: new Date('2026-03-01T12:00:00Z'),
          feature: { key: 'nota_fiscal', name: 'Nota Fiscal' },
        },
      ],
      ...overrides,
    });

    const company = (overrides: Record<string, unknown> = {}) => ({
      id: 'company-1',
      name: 'Test Co',
      legalName: 'Test Co LTDA',
      cnpj: '12345678901234',
      email: 'test@co.com',
      phone: '11999999999',
      mobile: null,
      favIconUrl: null,
      blockLevel: 'NONE',
      ownerUserId: 'owner-1',
      createdAt: new Date('2026-01-10T12:00:00Z'),
      blockedAt: null,
      blockReason: null,
      Subscription: [subscription()],
      address: [{ state: 'SP', city: 'São Paulo' }],
      ...overrides,
    });

    /** As consultas que montam as linhas, na ordem em que acontecem. */
    const mockAccountQueries = ({
      charges = [] as unknown[],
      usersInUse = [{ companyId: 'company-1', _count: { _all: 4 } }],
    } = {}) => {
      mockPrismaService.employee.findMany.mockResolvedValueOnce([
        {
          companyId: 'company-1',
          cpf: '12345678901',
          user: {
            id: 'user-1',
            name: 'John',
            phone: '11999999999',
            email: 'john@test.com',
          },
        },
      ]);
      mockPrismaService.employee.groupBy.mockResolvedValueOnce(usersInUse);
      mockPrismaService.user.findMany.mockResolvedValueOnce([
        {
          id: 'owner-1',
          name: 'Ana Titular',
          email: 'ana@co.com',
          phone: null,
        },
      ]);
      mockPrismaService.payment.findMany.mockResolvedValueOnce(charges);
    };

    const listWith = async (
      companies: unknown[],
      query: AccountListQuery = {},
      queries: Parameters<typeof mockAccountQueries>[0] = {},
    ) => {
      mockPrismaService.company.findMany.mockResolvedValue(companies);
      mockPrismaService.company.count.mockResolvedValue(companies.length);
      mockAccountQueries(queries);
      return service.listActiveClients({
        page: 1,
        limit: 10,
        groupBy: 'none',
        ...query,
      });
    };

    const whereOfList = () =>
      mockPrismaService.company.findMany.mock.calls[0][0].where;

    it('a linha traz o que a cobrança precisa: módulos, usuários, valor e forma de cobrança', async () => {
      const result: any = await listWith(
        [company()],
        {},
        {
          charges: [
            { subscriptionId: 'sub-1', status: 'PENDING', dueDate: FUTURE },
          ],
        },
      );

      expect(result).toMatchObject({ total: 1, page: 1, lastPage: 1 });
      expect(result.data[0]).toMatchObject({
        id: 'company-1',
        plan: 'Start',
        status: 'ACTIVE',
        // O primeiro colaborador com acesso segue na linha: Editar e Redefinir
        // senha agem sobre ele.
        userId: 'user-1',
        owner: { id: 'owner-1', name: 'Ana Titular' },
        cycle: 'MONTHLY',
        billingMode: 'ASAAS_SUBSCRIPTION',
        valueCents: 30700,
        nextChargeDate: FUTURE,
        hasOverdueCharge: false,
        modules: [
          { key: 'nota_fiscal', name: 'Nota Fiscal', priceCents: 7000 },
        ],
        users: {
          inUse: 4,
          included: 3,
          additional: 2,
          limit: 5,
          additionalUserPriceCents: 1500,
        },
      });
    });

    it('contratação à espera do pagamento aparece como "aguardando pagamento", não como inativa', async () => {
      const awaiting = company({
        Subscription: [subscription({ status: 'INACTIVE', endedReason: null })],
      });

      const result: any = await listWith(
        [awaiting],
        {},
        {
          charges: [
            { subscriptionId: 'sub-1', status: 'PENDING', dueDate: FUTURE },
          ],
        },
      );
      expect(result.data[0].status).toBe('AWAITING_PAYMENT');

      // Sem cobrança em aberto, é inativa mesmo.
      mockPrismaService.company.findMany.mockReset();
      const inactive: any = await listWith([awaiting]);
      expect(inactive.data[0].status).toBe('INACTIVE');
    });

    it('a conta mostra a assinatura ativa, não uma contratação mais nova que não foi concluída', async () => {
      const failedEvolution = subscription({
        id: 'sub-lite',
        status: 'INACTIVE',
        createdAt: new Date('2026-05-01T12:00:00Z'),
        plan: {
          name: 'Lite',
          planType: 'LITE',
          additionalUserPrice: 1500,
          planLimits: [{ value: 5 }],
        },
      });

      const result: any = await listWith([
        company({ Subscription: [failedEvolution, subscription()] }),
      ]);

      expect(result.data[0]).toMatchObject({
        subscriptionId: 'sub-1',
        plan: 'Start',
      });
      // A reserva `temp_` e a contratação desfeita nem chegam à linha.
      expect(mockPrismaService.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            Subscription: expect.objectContaining({
              where: ACCOUNT_SUBSCRIPTION_WHERE,
            }),
          }),
        }),
      );
    });

    it('sem groupBy, mantém os grupos por data que a tela anterior espera', async () => {
      const result: any = await listWith([company()], { groupBy: undefined });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].date).toBe('2026-01-15');
      expect(result.data[0].data[0]).toMatchObject({
        userId: 'user-1',
        plan: 'Start',
      });
    });

    it('cobrança pendente com vencimento passado conta como vencida', async () => {
      const result: any = await listWith(
        [company()],
        {},
        {
          charges: [
            { subscriptionId: 'sub-1', status: 'PENDING', dueDate: PAST },
          ],
        },
      );

      expect(result.data[0].hasOverdueCharge).toBe(true);
      // Sem cobrança futura gerada, vale o próximo vencimento da assinatura.
      expect(result.data[0].nextChargeDate).toEqual(
        new Date('2026-02-15T12:00:00Z'),
      );
    });

    it('assinatura manual aparece como manual e sem vencimento', async () => {
      const result: any = await listWith([
        company({
          Subscription: [
            subscription({
              asaasSubscriptionId: 'manual_123',
              additionalUsers: 0,
            }),
          ],
        }),
      ]);

      expect(result.data[0]).toMatchObject({
        billingMode: 'MANUAL',
        nextChargeDate: null,
      });
    });

    it('plano sem limite de usuários não tem limite na linha', async () => {
      const result: any = await listWith([
        company({
          Subscription: [
            subscription({
              plan: {
                name: 'Full',
                planType: 'FULL',
                additionalUserPrice: 1500,
                planLimits: [{ value: -1 }],
              },
            }),
          ],
        }),
      ]);

      expect(result.data[0].users).toMatchObject({
        included: null,
        additional: 2,
        limit: null,
      });
    });

    it('o filtro de módulo olha a assinatura em vigor', async () => {
      await listWith([], { status: 'bloqueadas', module: 'nota_fiscal' });

      const active = {
        AND: [ACCOUNT_SUBSCRIPTION_WHERE, { status: 'ACTIVE' }],
      };
      const withModule = {
        subscriptionFeatures: {
          some: {
            isActive: true,
            grantSource: null,
            feature: { key: 'nota_fiscal' },
          },
        },
      };
      expect(whereOfList().AND).toEqual([
        {
          blockLevel: 'PARTIAL',
          Subscription: { some: { AND: [ACCOUNT_SUBSCRIPTION_WHERE, {}] } },
        },
        {
          OR: [
            { Subscription: { some: { AND: [active, withModule] } } },
            {
              Subscription: {
                none: active,
                some: { AND: [ACCOUNT_SUBSCRIPTION_WHERE, withModule] },
              },
            },
          ],
        },
      ]);
    });

    it('filtra sem módulo, por usuários adicionais, plano, forma de cobrança e UF', async () => {
      await listWith([], {
        module: 'none',
        additionalUsers: 'with',
        plan: 'LITE',
        billingMode: 'MANUAL',
        state: 'sc',
      });

      const where = JSON.stringify(whereOfList());
      expect(where).toContain(
        '"subscriptionFeatures":{"none":{"isActive":true,"grantSource":null}}',
      );
      expect(where).toContain('"additionalUsers":{"gt":0}');
      expect(where).toContain('"plan":{"planType":"LITE"}');
      expect(where).toContain('{"billingMode":"MANUAL"}');
      expect(whereOfList().AND).toContainEqual({
        address: {
          some: {
            type: 'Principal',
            state: { equals: 'sc', mode: 'insensitive' },
          },
        },
      });
    });

    it('a busca acha o CNPJ digitado com máscara', async () => {
      await listWith([], { search: '12.345.678/0001-90' });

      expect(whereOfList().AND[1].OR).toContainEqual({
        cnpj: { contains: '12345678000190' },
      });
    });

    it('a busca acha a conta pelo e-mail de um usuário dela ou do cadastro de cobrança', async () => {
      await listWith([], { search: 'gabriel@x.com' });

      const email = { contains: 'gabriel@x.com', mode: 'insensitive' };
      expect(whereOfList().AND[1].OR).toEqual(
        expect.arrayContaining([
          { employees: { some: { user: { email } } } },
          { customer: { some: { email } } },
        ]),
      );
    });

    it('a exportação devolve todas as contas do filtro, sem paginação', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([company()]);
      mockAccountQueries();

      const result: any = await service.exportActiveClients({ module: 'any' });

      const args = mockPrismaService.company.findMany.mock.calls[0][0];
      expect(args.skip).toBeUndefined();
      expect(args.take).toBeUndefined();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].modules).toHaveLength(1);
    });
  });

  describe('getAccountFilterOptions', () => {
    it('lista os módulos e as UFs sem repetir', async () => {
      mockPrismaService.feature.findMany.mockResolvedValue([
        { key: 'nota_fiscal', name: 'Nota Fiscal' },
      ]);
      mockPrismaService.address.findMany.mockResolvedValue([
        { state: 'SC' },
        { state: 'SC ' },
        { state: '' },
        { state: 'SP' },
      ]);

      const result = await service.getAccountFilterOptions();

      expect(result).toEqual({
        modules: [{ key: 'nota_fiscal', name: 'Nota Fiscal' }],
        states: ['SC', 'SP'],
      });
    });
  });

  describe('getAccountDetails', () => {
    it('empresa inexistente dá 404', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue(null);

      await expect(service.getAccountDetails('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('empresa sem plano pago dá 404', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        Subscription: [],
        address: [],
      });

      await expect(service.getAccountDetails('company-1')).rejects.toThrow(
        'A empresa não tem assinatura de plano pago',
      );
    });

    it('traz o resumo da conta, os usuários em uso, as cobranças e as mudanças', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Test Co',
        legalName: 'Test Co LTDA',
        cnpj: '12345678901234',
        email: 'test@co.com',
        phone: null,
        mobile: '11988887777',
        favIconUrl: null,
        blockLevel: 'NONE',
        ownerUserId: 'owner-1',
        createdAt: new Date('2026-01-10T12:00:00Z'),
        blockedAt: null,
        blockReason: null,
        Subscription: [
          {
            id: 'sub-1',
            createdAt: new Date('2026-01-15T12:00:00Z'),
            nextDueDate: new Date('2026-02-15T12:00:00Z'),
            contractedAt: null,
            status: 'ACTIVE',
            cycle: 'YEARLY',
            billingType: 'CREDIT_CARD',
            billingMode: 'ASAAS_INSTALLMENT',
            asaasSubscriptionId: 'inst_sub-1',
            installmentCount: 12,
            couponCode: 'BEMVINDO',
            value: 1617,
            additionalUsers: 0,
            plan: {
              name: 'Start',
              planType: 'START',
              additionalUserPrice: 1500,
              planLimits: [{ value: 3 }],
            },
            subscriptionFeatures: [],
          },
        ],
        address: [],
      });
      // As linhas: primeiro colaborador, usuários em uso, titular, cobranças em aberto.
      mockPrismaService.employee.findMany.mockResolvedValueOnce([]);
      mockPrismaService.employee.groupBy.mockResolvedValueOnce([
        { companyId: 'company-1', _count: { _all: 2 } },
      ]);
      mockPrismaService.user.findMany.mockResolvedValueOnce([
        { id: 'owner-1', name: 'Ana', email: 'ana@co.com', phone: null },
      ]);
      mockPrismaService.payment.findMany.mockResolvedValueOnce([]);
      // O detalhe: os usuários em uso, as cobranças e o histórico.
      mockPrismaService.employee.findMany.mockResolvedValueOnce([
        {
          role: { name: 'Administrador', isAdmin: true },
          user: { id: 'owner-1', name: 'Ana', email: 'ana@co.com' },
        },
        {
          role: null,
          user: { id: 'user-2', name: 'Bia', email: 'bia@co.com' },
        },
      ]);
      mockPrismaService.payment.findMany.mockResolvedValueOnce([
        {
          id: 'pay-1',
          dueDate: new Date('2026-02-15T12:00:00Z'),
          value: 134.75,
          status: 'RECEIVED',
          paymentDate: new Date('2026-02-14T12:00:00Z'),
          confirmedDate: null,
          billingType: 'CREDIT_CARD',
          description: 'Parcela 1 de 12',
          invoiceUrl: 'https://asaas/i/1',
        },
      ]);
      mockPrismaService.subscriptionHistory.findMany.mockResolvedValueOnce([
        {
          id: 'h-1',
          action: 'COMPLEMENTS_ADDED',
          description: 'Complementos incluídos: Nota Fiscal.',
          createdAt: new Date('2026-03-01T12:00:00Z'),
          createdByName: 'Ana',
        },
      ]);
      const lastActive = new Date('2026-10-01T12:00:00Z');
      mockPrismaService.userActivity.groupBy.mockResolvedValueOnce([
        { userId: 'owner-1', _max: { lastActive } },
      ]);

      const result: any = await service.getAccountDetails('company-1');

      expect(result.account).toMatchObject({
        billingMode: 'ASAAS_INSTALLMENT',
        installmentCount: 12,
        valueCents: 161700,
        users: { inUse: 2, included: 3, additional: 0, limit: 3 },
      });
      expect(result.company.phone).toBe('11988887777');
      expect(result.subscription).toMatchObject({
        couponCode: 'BEMVINDO',
        // Sem a data de contratação (assinaturas antigas), vale a criação.
        contractedAt: new Date('2026-01-15T12:00:00Z'),
      });
      expect(result.users).toEqual([
        {
          id: 'owner-1',
          name: 'Ana',
          email: 'ana@co.com',
          role: 'Administrador',
          isAdmin: true,
          isOwner: true,
          lastAccessAt: lastActive,
        },
        {
          id: 'user-2',
          name: 'Bia',
          email: 'bia@co.com',
          role: null,
          isAdmin: false,
          isOwner: false,
          lastAccessAt: null,
        },
      ]);
      expect(result.payments[0]).toMatchObject({
        valueCents: 13475,
        status: 'RECEIVED',
        paidAt: new Date('2026-02-14T12:00:00Z'),
      });
      expect(result.changes).toHaveLength(1);
      expect(
        mockPrismaService.subscriptionHistory.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subscriptionId: { in: ['sub-1'] },
          }),
        }),
      );
    });
  });

  // ─── listTrialCompanies ────────────────────────────────────────────────

  describe('listTrialCompanies', () => {
    it('should return trial companies with correct status categorization', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 5);

      mockPrismaService.subscription.findMany
        .mockResolvedValueOnce([
          // All trial subs
          {
            id: 'sub-1',
            companyId: 'c1',
            status: 'ACTIVE',
            nextDueDate: future,
            createdAt: new Date('2026-01-10'),
            Company: {
              id: 'c1',
              name: 'Active Trial',
              legalName: 'Active Trial LTDA',
              cnpj: '111',
              email: 'a@t.com',
              phone: '111',
              mobile: null,
              favIconUrl: null,
              address: [],
            },
            plan: { name: 'TRIAL', planType: 'TRIAL' },
            customer: { name: 'C1' },
          },
        ])
        .mockResolvedValueOnce([]); // No active subs for inactive check

      mockPrismaService.employee.findFirst.mockResolvedValue(null);
      mockPrismaService.company.findMany.mockResolvedValue([]);

      const result = await service.listTrialCompanies(1, 10);

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('conta trial que contratou e não pagou não aparece entre os testes', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 5);

      mockPrismaService.subscription.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          companyId: 'c1',
          status: 'ACTIVE' as const,
          nextDueDate: future,
          createdAt: new Date(),
          Company: { id: 'c1', name: 'Cencom', address: [] },
          plan: { name: 'TRIAL', planType: 'TRIAL' },
          customer: {},
        },
      ]);
      mockPrismaService.employee.findFirst.mockResolvedValue(null);
      mockPrismaService.company.findMany.mockResolvedValue([{ id: 'c1' }]);

      const result = await service.listTrialCompanies(1, 10, 'ativas');

      expect(result.total).toBe(0);
      expect(result.data).toHaveLength(0);
    });

    it('a busca acha o teste pelo e-mail de um usuário dele ou do cadastro de cobrança', async () => {
      // O teste vencido da Comunicca tinha o e-mail da empresa diferente do
      // e-mail do titular, que estava preso no cadastro.
      mockPrismaService.subscription.findMany.mockResolvedValue([]);
      mockPrismaService.company.findMany.mockResolvedValue([]);

      await service.listTrialCompanies(
        1,
        10,
        'inativas',
        'name',
        'gabriel@x.com',
      );

      const email = { contains: 'gabriel@x.com', mode: 'insensitive' };
      const [{ where }] = mockPrismaService.subscription.findMany.mock.calls[0];
      expect(where.OR).toContainEqual({
        Company: {
          OR: [
            { employees: { some: { user: { email } } } },
            { customer: { some: { email } } },
          ],
        },
      });
    });

    it('should filter by status "ativas" excluding expired trials', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 5);

      const allTrialData = [
        {
          id: 'sub-1',
          companyId: 'c1',
          status: 'ACTIVE' as const,
          nextDueDate: future,
          createdAt: new Date(),
          Company: { id: 'c1', name: 'Active Trial', address: [] },
          plan: { name: 'TRIAL', planType: 'TRIAL' },
          customer: {},
        },
      ];

      mockPrismaService.subscription.findMany.mockResolvedValue(allTrialData);
      mockPrismaService.employee.findFirst.mockResolvedValue(null);
      mockPrismaService.company.findMany.mockResolvedValue([]);

      const result = await service.listTrialCompanies(1, 10, 'ativas');

      expect(result.total).toBe(1);
    });
  });
});
