import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { CouponsService } from '../../coupons/coupons.service';
import { SubscriptionQuoteService } from './subscription-quote.service';

const AGORA = new Date('2026-08-25T12:00:00.000Z');

const plan = (planType: string, basePrice: number, isActive = true) => ({
  id: `plan-${planType}`,
  name: `Atrupe ${planType[0]}${planType.slice(1).toLowerCase()}`,
  planType,
  basePrice,
  additionalUserPrice: 1500,
  isActive,
  companyId: null,
  order: ['START', 'LITE', 'PRO', 'ELITE', 'FULL'].indexOf(planType),
});

const catalog = (liteActive: boolean) => [
  plan('START', 14700),
  plan('LITE', 23000, liteActive),
  plan('PRO', 37000, false),
  plan('ELITE', 59000, false),
  plan('FULL', 89000, false),
];

const payment = (status: string, overrides: Record<string, any> = {}) => ({
  status,
  value: 147,
  grossValue: null,
  dueDate: new Date('2026-08-15T00:00:00.000Z'),
  ...overrides,
});

const subscription = (overrides: Record<string, any> = {}) => ({
  id: 'sub-1',
  planId: 'plan-START',
  cycle: 'MONTHLY',
  contractedAt: null,
  plan: plan('START', 14700),
  payments: [payment('CONFIRMED')],
  ...overrides,
});

describe('SubscriptionQuoteService', () => {
  let service: SubscriptionQuoteService;

  const prisma = {
    subscription: { findFirst: jest.fn(), findUnique: jest.fn() },
    plan: { findFirst: jest.fn(), findMany: jest.fn() },
    feature: { findMany: jest.fn() },
  };
  const coupons = { validateCoupon: jest.fn() };

  /** Primeira busca: assinatura paga ativa; segunda: contratação pendente. */
  const withSubscriptions = (active: any, pending: any = null) => {
    prisma.subscription.findFirst
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(pending);
  };

  const withCatalog = (liteActive = false) => {
    const plans = catalog(liteActive);
    prisma.plan.findMany.mockResolvedValue(plans);
    prisma.plan.findFirst.mockImplementation(({ where }) =>
      Promise.resolve(plans.find((p) => p.id === where.id) ?? null),
    );
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionQuoteService,
        { provide: PrismaService, useValue: prisma },
        { provide: CouponsService, useValue: coupons },
      ],
    }).compile();
    service = module.get(SubscriptionQuoteService);
  });

  describe('assinatura recebida por transferência de titularidade', () => {
    // A primeira cobrança da assinatura nova, ainda por vencer.
    const received = subscription({
      id: 'sub-2',
      previousSubscriptionId: 'sub-1',
      payments: [
        payment('PENDING', { dueDate: new Date('2026-09-15T00:00:00.000Z') }),
      ],
    });

    it('o que foi pago antes da transferência segue pago: não vira regularização', async () => {
      withSubscriptions(received);
      prisma.subscription.findUnique.mockResolvedValueOnce({
        endedReason: 'TRANSFERRED',
        previousSubscriptionId: null,
        payments: [payment('CONFIRMED')],
      });

      const ctx = await service.getBillingContext('company-1', AGORA);

      expect(prisma.subscription.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sub-1' } }),
      );
      expect(ctx.intent).toBe('EVOLUTION');
      expect(ctx.firstChargePending).toBe(false);
      expect(ctx.confirmedPayment).toMatchObject({ status: 'CONFIRMED' });
    });

    it('a anterior encerrada por evolução não é herdada: o crédito dela já foi usado', async () => {
      withSubscriptions(received);
      prisma.subscription.findUnique.mockResolvedValueOnce({
        endedReason: 'EVOLVED',
        previousSubscriptionId: null,
        payments: [payment('CONFIRMED')],
      });

      const ctx = await service.getBillingContext('company-1', AGORA);

      expect(ctx.confirmedPayment).toBeNull();
      expect(ctx.intent).toBe('REGULARIZATION');
    });
  });

  describe('sem contratação em curso', () => {
    it('só o START é oferecido, com o preço', async () => {
      withCatalog();
      withSubscriptions(null, null);

      const result = await service.getPlanStates('company-1');

      expect(result.intent).toBe('NEW');
      expect(result.plans[0]).toMatchObject({
        planType: 'START',
        state: 'ELEGIVEL',
        priceMonthlyCents: 14700,
      });
      expect(result.plans[1]).toMatchObject({
        planType: 'LITE',
        state: 'BLOQUEADO',
      });
    });

    it('orça o START mensal pelo motor', async () => {
      withCatalog();
      withSubscriptions(null, null);

      const result = await service.quote(
        'company-1',
        { planId: 'plan-START' },
        AGORA,
      );

      expect(result.eligible).toBe(true);
      expect(result.quote.totalCents).toBe(14700);
    });
  });

  describe('evolução', () => {
    it('o próximo liberado é elegível', async () => {
      withCatalog(true);
      withSubscriptions(subscription());

      const result = await service.quote(
        'company-1',
        { planId: 'plan-LITE' },
        AGORA,
      );

      expect(result.intent).toBe('EVOLUTION');
      expect(result.eligible).toBe(true);
    });

    it('o próximo não liberado não é orçado nem tem o preço revelado', async () => {
      withCatalog(false);
      withSubscriptions(subscription());

      const result = await service.quote(
        'company-1',
        { planId: 'plan-LITE' },
        AGORA,
      );

      expect(result).toMatchObject({
        eligible: false,
        ineligibilityReason: 'NOT_RELEASED',
        quote: null,
      });
    });

    it('a trilha esconde o preço do plano não liberado', async () => {
      withCatalog(false);
      withSubscriptions(subscription());

      const result = await service.getPlanStates('company-1');
      const lite = result.plans.find((p) => p.planType === 'LITE');

      expect(lite).toMatchObject({
        state: 'EM_BREVE',
        priceMonthlyCents: null,
      });
    });

    it('do anual não se evolui para o mensal', async () => {
      withCatalog(true);
      withSubscriptions(subscription({ cycle: 'YEARLY' }));

      const result = await service.quote(
        'company-1',
        { planId: 'plan-LITE', cycle: 'MONTHLY' },
        AGORA,
      );

      expect(result.ineligibilityReason).toBe('ANNUAL_TO_MONTHLY_NOT_ALLOWED');
    });

    it('do anual para o anual é permitido', async () => {
      withCatalog(true);
      withSubscriptions(subscription({ cycle: 'YEARLY' }));

      const result = await service.quote(
        'company-1',
        { planId: 'plan-LITE', cycle: 'YEARLY' },
        AGORA,
      );

      expect(result.eligible).toBe(true);
    });

    it('assinatura antiga, sem data de contratação, não gera crédito', async () => {
      withCatalog(true);
      withSubscriptions(subscription({ contractedAt: null }));

      const result = await service.quote(
        'company-1',
        { planId: 'plan-LITE' },
        AGORA,
      );

      expect(result.quote.creditCents).toBe(0);
      expect(result.quote.totalCents).toBe(23000);
    });

    it('com data de contratação e pagamento confirmado, abate o tempo não usado', async () => {
      withCatalog(true);
      withSubscriptions(
        subscription({
          contractedAt: new Date('2026-08-13T12:00:00.000Z'),
          payments: [
            payment('CONFIRMED', {
              periodStart: new Date('2026-08-13T12:00:00.000Z'),
              periodEnd: new Date('2026-09-13T12:00:00.000Z'),
            }),
          ],
        }),
      );

      const result = await service.quote(
        'company-1',
        { planId: 'plan-LITE' },
        AGORA,
      );

      // 147 × 19/31 = 90,10
      expect(result.quote.creditCents).toBe(9010);
      expect(result.quote.totalCents).toBe(23000 - 9010);
    });

    it('a partir do segundo mês, o crédito vem da última renovação paga', async () => {
      withCatalog(true);
      withSubscriptions(
        subscription({
          contractedAt: new Date('2026-06-13T12:00:00.000Z'),
          payments: [
            payment('PENDING', {
              dueDate: new Date('2026-09-15T00:00:00.000Z'),
            }),
            payment('CONFIRMED', {
              dueDate: new Date('2026-08-15T00:00:00.000Z'),
            }),
            payment('CONFIRMED', {
              dueDate: new Date('2026-07-15T00:00:00.000Z'),
            }),
            payment('CONFIRMED', {
              dueDate: new Date('2026-06-15T00:00:00.000Z'),
              periodStart: new Date('2026-06-13T12:00:00.000Z'),
              periodEnd: new Date('2026-07-15T12:00:00.000Z'),
            }),
          ],
        }),
      );

      const result = await service.quote(
        'company-1',
        { planId: 'plan-LITE' },
        AGORA,
      );

      // Renovação de 15/08 cobre até 15/09: 21 de 31 dias sem uso.
      // Contando da contratação, o ciclo teria acabado em 13/07 e não
      // haveria crédito nenhum.
      expect(result.quote.creditCents).toBe(Math.round((14700 * 21) / 31));
    });
  });

  describe('cobrança em aberto', () => {
    it('cobrança vencida exige regularizar, e nada é oferecido', async () => {
      withCatalog(true);
      withSubscriptions(subscription({ payments: [payment('OVERDUE')] }));

      const result = await service.quote(
        'company-1',
        { planId: 'plan-LITE' },
        AGORA,
      );

      expect(result.intent).toBe('REGULARIZATION');
      expect(result).toMatchObject({
        eligible: false,
        ineligibilityReason: 'REGULARIZATION_REQUIRED',
      });
    });

    it('contratação com acesso liberado e primeira cobrança pendente é regularização', async () => {
      withCatalog(true);
      withSubscriptions(
        subscription({
          contractedAt: new Date('2026-08-24T12:00:00.000Z'),
          payments: [
            payment('PENDING', {
              dueDate: new Date('2026-08-26T00:00:00.000Z'),
            }),
          ],
        }),
      );

      const result = await service.quote(
        'company-1',
        { planId: 'plan-LITE' },
        AGORA,
      );

      expect(result.intent).toBe('REGULARIZATION');
      expect(result.ineligibilityReason).toBe('REGULARIZATION_REQUIRED');
    });

    it('cobrança futura de renovação não é cobrança em aberto', async () => {
      withCatalog(true);
      withSubscriptions(
        subscription({
          payments: [
            payment('PENDING', {
              dueDate: new Date('2026-09-15T00:00:00.000Z'),
            }),
            payment('CONFIRMED'),
          ],
        }),
      );

      const result = await service.quote(
        'company-1',
        { planId: 'plan-LITE' },
        AGORA,
      );

      expect(result.intent).toBe('EVOLUTION');
    });

    it('contratação ainda não paga também é regularização', async () => {
      withCatalog(true);
      withSubscriptions(null, subscription({ payments: [payment('PENDING')] }));

      const result = await service.getPlanStates('company-1');

      expect(result.intent).toBe('REGULARIZATION');
      expect(result.plans.find((p) => p.planType === 'LITE')).toMatchObject({
        state: 'BLOQUEADO',
        reason: 'OPEN_CHARGE',
      });
    });
  });

  describe('entradas', () => {
    it('cupom recusado não derruba o orçamento', async () => {
      withCatalog();
      withSubscriptions(null, null);
      coupons.validateCoupon.mockRejectedValue(
        new BadRequestException('Cupom expirado.'),
      );

      const result = await service.quote(
        'company-1',
        { planId: 'plan-START', couponCode: ' velho ' },
        AGORA,
      );

      expect(result.quote.totalCents).toBe(14700);
      expect(result.quote.coupon).toEqual({
        code: 'VELHO',
        applied: false,
        reason: 'INVALID',
        message: 'Cupom expirado.',
      });
    });

    it('módulo desconhecido ou indisponível é recusado', async () => {
      withCatalog();
      withSubscriptions(null, null);
      prisma.feature.findMany.mockResolvedValue([]);

      await expect(
        service.quote(
          'company-1',
          { planId: 'plan-START', modules: ['inexistente'] },
          AGORA,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('módulo que o plano já inclui não é cobrado à parte', async () => {
      withCatalog(true);
      withSubscriptions(subscription());
      prisma.feature.findMany.mockResolvedValue([
        {
          key: 'nota_fiscal',
          name: 'Nota Fiscal',
          price: 7000,
          planFeatures: [{ id: 'pf-lite-nf' }],
        },
      ]);

      const result = await service.quote(
        'company-1',
        { planId: 'plan-LITE', modules: ['nota_fiscal'] },
        AGORA,
      );

      expect(result.quote.lines.map((l) => l.kind)).toEqual(['PLAN']);
      expect(result.quote.recurringCents).toBe(23000);
    });

    it('usuário sem empresa não tem orçamento', async () => {
      await expect(
        service.quote(undefined as any, { planId: 'plan-START' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
