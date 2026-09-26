import { Test, TestingModule } from '@nestjs/testing';
import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from '../asaas-gateway.service';
import { SubscriptionQuoteService } from '../pricing/subscription-quote.service';
import { computeQuote } from '../pricing/pricing.engine';
import { ContractAcceptanceService } from './contract-acceptance.service';
import { CompanySessionService } from './company-session.service';
import { EvolutionService } from './evolution.service';

const ADMIN = { userId: 'user-1', companyId: 'company-1', isAdmin: true };
const META = { ip: '200.1.2.3', userAgent: 'jest' };
const TERMS = { id: 'contract-2', version: 2, html: '<p>t</p>', sha256: 'abc' };
const ACCEPT = { contractId: 'contract-2', version: 2, accepted: true };

const LITE = {
  name: 'Atrupe Lite',
  basePriceCents: 23000,
  additionalUserPriceCents: 1500,
};
// Start pago em 13/08, evoluindo em 25/08: 19 de 31 dias sem uso.
const CREDITO_DO_START = {
  creditCents: 9010,
  remainingDays: 19,
  totalDays: 31,
  planName: 'Atrupe Start',
};

const LAST_ACCEPTANCE = {
  contractorType: 'PJ',
  contractorDocument: '11222333000181',
  contractorName: 'STUDIO NORTE ARQUITETURA LTDA',
  contractorTradeName: 'Studio Norte',
  contractorEmail: 'financeiro@studio.com',
  representativeCpf: '12348778700',
  representativeName: 'MARIA DA SILVA SOUZA',
  representativeVerified: true,
  representativeIsSessionUser: true,
  acceptedByUserId: 'user-1',
};

const CURRENT = {
  id: 'sub-start',
  customerId: 'cust-1',
  asaasSubscriptionId: 'sub_old',
  contractedAt: new Date('2026-08-13T12:00:00.000Z'),
  cycle: 'MONTHLY',
  plan: { name: 'Atrupe Start', planType: 'START' },
  payments: [],
};

const dto = (overrides: Record<string, any> = {}) => ({
  planId: 'plan-lite',
  billingType: 'BOLETO' as const,
  modules: [],
  additionalUsers: 0,
  termsAcceptance: ACCEPT,
  ...overrides,
});

describe('EvolutionService', () => {
  let service: EvolutionService;

  const tx = {
    $executeRaw: jest.fn(),
    subscription: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    subscriptionFeature: { create: jest.fn() },
    couponUsage: { create: jest.fn(), deleteMany: jest.fn() },
    coupon: { update: jest.fn() },
    payment: { create: jest.fn(), updateMany: jest.fn() },
    subscriptionHistory: { create: jest.fn() },
    company: { updateMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((cb: any) => cb(tx)),
    plan: { findUniqueOrThrow: jest.fn() },
    feature: { findMany: jest.fn() },
    user: { findUniqueOrThrow: jest.fn() },
    coupon: { findUnique: jest.fn() },
    customer: { findUnique: jest.fn() },
    contractAcceptance: { findFirst: jest.fn() },
    company: { findUnique: jest.fn() },
  };
  const gateway = {
    createSubscription: jest.fn(),
    createInstallmentCharge: jest.fn(),
    getAsaasSubscriptionPayments: jest.fn(),
    getInstallmentPayments: jest.fn(),
    // Como o gateway: parcelas do parcelamento, ou cobranças da assinatura.
    getChargesOf: jest.fn((sub: any) =>
      sub.asaasInstallmentId
        ? gateway.getInstallmentPayments(sub.asaasInstallmentId)
        : gateway.getAsaasSubscriptionPayments(sub.asaasSubscriptionId),
    ),
    updateAsaasPayment: jest.fn(),
    deleteAsaasPayment: jest.fn(),
    deleteInstallment: jest.fn(),
    cancelAsaasSubscription: jest.fn(),
    getPixQrCode: jest.fn(),
    mapAsaasPaymentStatus: jest.fn(() => 'PENDING'),
  };
  const quoteService = { quote: jest.fn(), getBillingContext: jest.fn() };
  const acceptance = { currentTerms: jest.fn(), record: jest.fn() };
  const session = { build: jest.fn() };

  const evolutionQuote = (credit = CREDITO_DO_START) => ({
    intent: 'EVOLUTION',
    eligible: true,
    plan: { id: 'plan-lite', name: 'Atrupe Lite', planType: 'LITE' },
    quote: computeQuote({
      plan: LITE,
      cycle: 'MONTHLY',
      evolutionCredit: credit,
    }),
  });

  /** O Asaas da assinatura anterior e da nova. */
  const withGatewayPayments = (oldPayments: any[]) => {
    gateway.getAsaasSubscriptionPayments.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'sub_new'
          ? [
              {
                id: 'pay_new',
                value: 230,
                dueDate: '2026-09-24',
                status: 'PENDING',
                invoiceUrl: 'https://asaas/i/new',
              },
            ]
          : oldPayments,
      ),
    );
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb: any) => cb(tx));
    // Na reserva: a assinatura em curso ainda está ativa; nada em andamento.
    tx.subscription.findFirst.mockImplementation(({ where }) =>
      Promise.resolve(where.id === 'sub-start' ? { id: 'sub-start' } : null),
    );
    tx.subscription.create.mockResolvedValue({ id: 'sub-local-1' });
    tx.subscription.update.mockResolvedValue({});
    tx.payment.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'pay-local-1', ...data }),
    );
    tx.couponUsage.deleteMany.mockResolvedValue({ count: 0 });

    quoteService.quote.mockResolvedValue(evolutionQuote());
    quoteService.getBillingContext.mockResolvedValue({
      intent: 'EVOLUTION',
      hasOpenCharge: false,
      current: CURRENT,
    });
    prisma.plan.findUniqueOrThrow.mockResolvedValue({
      id: 'plan-lite',
      name: 'Atrupe Lite',
    });
    prisma.feature.findMany.mockResolvedValue([]);
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'user-1',
      name: 'Marcos',
      email: 'marcos@studio.com',
    });
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      asaasCustomerId: 'cus_1',
      document: '11222333000181',
      name: 'STUDIO NORTE ARQUITETURA LTDA',
      email: 'financeiro@studio.com',
    });
    prisma.contractAcceptance.findFirst.mockResolvedValue(LAST_ACCEPTANCE);

    gateway.createSubscription.mockResolvedValue({
      id: 'sub_new',
      nextDueDate: '2026-09-24',
    });
    withGatewayPayments([
      // Renovação futura que o Asaas já gerou para a assinatura anterior.
      {
        id: 'pay_old_next',
        value: 147,
        dueDate: '2099-01-15',
        status: 'PENDING',
      },
      {
        id: 'pay_old_paid',
        value: 147,
        dueDate: '2000-01-15',
        status: 'RECEIVED',
      },
    ]);
    gateway.updateAsaasPayment.mockResolvedValue({
      value: 139.9,
      invoiceUrl: 'https://asaas/i/new',
    });
    // clearAllMocks não desfaz implementações: cada teste começa do zero.
    gateway.cancelAsaasSubscription.mockResolvedValue(undefined);
    gateway.deleteAsaasPayment.mockResolvedValue(undefined);
    gateway.getPixQrCode.mockResolvedValue(null);
    acceptance.currentTerms.mockResolvedValue(TERMS);
    acceptance.record.mockResolvedValue({ id: 'acc-1', version: 2 });
    session.build.mockResolvedValue({ plan: { name: 'LITE', active: true } });
    // O ADMIN é o administrador principal da conta (Usuário nº 1).
    prisma.company.findUnique.mockResolvedValue({ ownerUserId: 'user-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvolutionService,
        { provide: PrismaService, useValue: prisma },
        { provide: AsaasGatewayService, useValue: gateway },
        { provide: SubscriptionQuoteService, useValue: quoteService },
        { provide: ContractAcceptanceService, useValue: acceptance },
        { provide: CompanySessionService, useValue: session },
      ],
    }).compile();
    service = module.get(EvolutionService);
  });

  describe('quem evolui e para onde', () => {
    it('só administrador evolui', async () => {
      await expect(
        service.evolve({ ...ADMIN, isAdmin: false }, dto(), META),
      ).rejects.toThrow(ForbiddenException);
    });

    it('alterar o plano é do Usuário nº 1: outro administrador é recusado (contrato, 4.2)', async () => {
      await expect(
        service.evolve({ ...ADMIN, userId: 'outro-admin' }, dto(), META),
      ).rejects.toMatchObject({ response: { code: 'OWNER_ONLY' } });
      expect(gateway.createSubscription).not.toHaveBeenCalled();
    });

    it('com a chave em "false", o anual não é oferecido', async () => {
      const original = process.env.ANNUAL_CYCLE_ENABLED;
      process.env.ANNUAL_CYCLE_ENABLED = 'false';
      await expect(
        service.evolve(ADMIN, dto({ cycle: 'YEARLY' }), META),
      ).rejects.toMatchObject({ response: { code: 'CYCLE_NOT_AVAILABLE' } });
      process.env.ANNUAL_CYCLE_ENABLED = original;
    });

    it('com cobrança em aberto, pede regularização', async () => {
      quoteService.quote.mockResolvedValue({
        ...evolutionQuote(),
        intent: 'REGULARIZATION',
        eligible: false,
      });
      await expect(service.evolve(ADMIN, dto(), META)).rejects.toMatchObject({
        response: { code: 'REGULARIZATION_REQUIRED' },
      });
    });

    it('plano ainda não liberado não é evoluível', async () => {
      quoteService.quote.mockResolvedValue({
        ...evolutionQuote(),
        eligible: false,
        ineligibilityReason: 'NOT_RELEASED',
        quote: null,
      });
      await expect(service.evolve(ADMIN, dto(), META)).rejects.toMatchObject({
        response: { code: 'PLAN_NOT_AVAILABLE', reason: 'NOT_RELEASED' },
      });
      expect(gateway.createSubscription).not.toHaveBeenCalled();
    });

    it('preço que mudou desde o resumo é recusado com o orçamento novo', async () => {
      await expect(
        service.evolve(ADMIN, dto({ expectedTotalCents: 23000 }), META),
      ).rejects.toMatchObject({
        response: { code: 'PRICE_CHANGED', quote: { totalCents: 13990 } },
      });
    });

    it('assinatura sem cliente no Asaas não tem onde cobrar', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        asaasCustomerId: 'manual_1',
        document: '11222333000181',
        name: 'X',
        email: 'x@x.com',
      });
      await expect(service.evolve(ADMIN, dto(), META)).rejects.toMatchObject({
        response: { code: 'BILLING_ACCOUNT_REQUIRED' },
      });
      expect(gateway.createSubscription).not.toHaveBeenCalled();
    });
  });

  describe('evolução com crédito', () => {
    it('assinatura nova com o valor cheio e a primeira cobrança com o crédito abatido', async () => {
      const result = await service.evolve(ADMIN, dto(), META);

      expect(gateway.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_1',
          value: 230,
          cycle: 'MONTHLY',
          externalReference: 'sub-local-1',
        }),
      );
      // 230 − 90,10 de crédito
      expect(gateway.updateAsaasPayment).toHaveBeenCalledWith('pay_new', {
        value: 139.9,
      });
      expect(tx.subscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousSubscriptionId: 'sub-start',
          recurringValueCents: 23000,
          evolutionCreditCents: 9010,
          status: 'INACTIVE',
        }),
      });
      expect(result).toMatchObject({
        paymentUrl: 'https://asaas/i/new',
        creditCents: 9010,
        subscription: { id: 'sub-local-1', planName: 'Atrupe Lite' },
      });
    });

    it('a anterior só deixa de cobrar depois de a nova existir, e sem renovações futuras', async () => {
      await service.evolve(ADMIN, dto(), META);

      const created = gateway.createSubscription.mock.invocationCallOrder[0];
      const deleted = gateway.deleteAsaasPayment.mock.invocationCallOrder[0];
      const canceled =
        gateway.cancelAsaasSubscription.mock.invocationCallOrder[0];
      expect(gateway.deleteAsaasPayment).toHaveBeenCalledTimes(1);
      expect(gateway.deleteAsaasPayment).toHaveBeenCalledWith('pay_old_next');
      expect(gateway.cancelAsaasSubscription).toHaveBeenCalledWith('sub_old');
      expect(created).toBeLessThan(deleted);
      expect(deleted).toBeLessThan(canceled);
    });

    it('registra a anterior como evoluída, a cobrança com o crédito e o aceite', async () => {
      await service.evolve(ADMIN, dto(), META);

      expect(tx.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-start' },
        data: { status: 'CANCELED', endedReason: 'EVOLVED' },
      });
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-start', status: 'PENDING' },
        data: { status: 'CANCELED' },
      });
      expect(tx.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subscriptionId: 'sub-local-1',
          asaasPaymentId: 'pay_new',
          kind: 'EVOLUTION',
          grossValue: 230,
          creditApplied: 90.1,
        }),
      });
      const [, input] = acceptance.record.mock.calls[0];
      expect(input).toMatchObject({
        context: 'EVOLUTION',
        subscriptionId: 'sub-local-1',
        contractor: { type: 'PJ', document: '11222333000181' },
        representative: {
          cpf: '12348778700',
          name: 'MARIA DA SILVA SOUZA',
          verified: true,
          isSessionUser: true,
        },
      });
    });

    it('crédito que cobre a primeira cobrança: nada é cobrado agora', async () => {
      quoteService.quote.mockResolvedValue(
        evolutionQuote({ ...CREDITO_DO_START, creditCents: 40000 }),
      );
      const antes = Date.now();

      const result = await service.evolve(ADMIN, dto(), META);

      // A assinatura nova começa a cobrar no ciclo seguinte.
      const { nextDueDate } = gateway.createSubscription.mock.calls[0][0];
      expect(nextDueDate.getTime() - antes).toBeGreaterThan(27 * 86_400_000);
      expect(gateway.updateAsaasPayment).not.toHaveBeenCalled();
      expect(tx.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          asaasPaymentId: 'credit_sub-local-1',
          value: 0,
          status: 'CONFIRMED',
          creditApplied: 230,
          kind: 'EVOLUTION',
        }),
      });
      expect(result.paymentUrl).toBeNull();
    });
  });

  describe('quando algo falha', () => {
    it('cobrança vencida no Asaas que o banco não viu: nada muda e a nova é desfeita', async () => {
      withGatewayPayments([
        {
          id: 'pay_old_due',
          value: 147,
          dueDate: '2000-01-15',
          status: 'OVERDUE',
        },
      ]);

      await expect(service.evolve(ADMIN, dto(), META)).rejects.toMatchObject({
        response: { code: 'REGULARIZATION_REQUIRED' },
      });
      expect(gateway.deleteAsaasPayment).not.toHaveBeenCalled();
      expect(gateway.cancelAsaasSubscription).toHaveBeenCalledWith('sub_new');
      expect(gateway.cancelAsaasSubscription).not.toHaveBeenCalledWith(
        'sub_old',
      );
      expect(tx.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-local-1' },
        data: { status: 'CANCELED', endedReason: 'ABANDONED' },
      });
    });

    it('falha ao encerrar a anterior desfaz a evolução, e a anterior segue', async () => {
      gateway.cancelAsaasSubscription.mockImplementation((id: string) =>
        id === 'sub_old'
          ? Promise.reject(new Error('Asaas fora'))
          : Promise.resolve(),
      );

      await expect(service.evolve(ADMIN, dto(), META)).rejects.toThrow(
        BadGatewayException,
      );
      expect(gateway.cancelAsaasSubscription).toHaveBeenCalledWith('sub_new');
      expect(acceptance.record).not.toHaveBeenCalled();
    });

    it('ativação que falha uma vez é tentada de novo', async () => {
      tx.subscription.update.mockRejectedValueOnce(new Error('deadlock'));

      const result = await service.evolve(ADMIN, dto(), META);

      expect(result.subscription.id).toBe('sub-local-1');
      expect(gateway.cancelAsaasSubscription).not.toHaveBeenCalledWith(
        'sub_new',
      );
      expect(acceptance.record).toHaveBeenCalledTimes(1);
    });
  });

  describe('ciclo anual', () => {
    const original = process.env.ANNUAL_CYCLE_ENABLED;
    beforeEach(() => {
      process.env.ANNUAL_CYCLE_ENABLED = 'true';
    });
    afterEach(() => {
      process.env.ANNUAL_CYCLE_ENABLED = original;
    });

    // Anual parcelado em curso: sem assinatura no Asaas, com a renovação do
    // ano seguinte já criada e ainda não paga.
    const anualParcelado = {
      ...CURRENT,
      asaasSubscriptionId: 'inst_sub-start',
      asaasInstallmentId: 'ins_renovacao',
      billingMode: 'ASAAS_INSTALLMENT',
      cycle: 'YEARLY',
    };
    const liteAnualEm12x = () => ({
      ...evolutionQuote(),
      quote: computeQuote({
        plan: LITE,
        cycle: 'YEARLY',
        billingType: 'CREDIT_CARD',
        installmentCount: 12,
        evolutionCredit: CREDITO_DO_START,
      }),
    });

    beforeEach(() => {
      quoteService.getBillingContext.mockResolvedValue({
        intent: 'EVOLUTION',
        hasOpenCharge: false,
        current: anualParcelado,
      });
      quoteService.quote.mockResolvedValue(liteAnualEm12x());
      gateway.getInstallmentPayments.mockImplementation((id: string) =>
        Promise.resolve(
          id === 'ins_renovacao'
            ? [
                {
                  id: 'pay_renov_1',
                  value: 134.75,
                  dueDate: '2099-01-15',
                  status: 'PENDING',
                },
              ]
            : Array.from({ length: 12 }, (_, i) => ({
                id: 'pay_novo_' + (i + 1),
                value: 200,
                dueDate: '2026-09-24',
                status: 'PENDING',
                installment: 'ins_novo',
                installmentNumber: i + 1,
                invoiceUrl: 'https://asaas/i/novo',
              })),
        ),
      );
      gateway.createInstallmentCharge.mockResolvedValue({
        id: 'pay_novo_1',
        installment: 'ins_novo',
      });
    });

    it('do anual parcelado para o anual em 12x: a renovação não paga some, e não há assinatura a cancelar', async () => {
      const result = await service.evolve(
        ADMIN,
        dto({
          cycle: 'YEARLY',
          billingType: 'CREDIT_CARD',
          installmentCount: 12,
        }),
        META,
      );

      expect(gateway.createInstallmentCharge).toHaveBeenCalledWith(
        expect.objectContaining({ installmentCount: 12 }),
      );
      expect(gateway.deleteAsaasPayment).toHaveBeenCalledWith('pay_renov_1');
      expect(gateway.cancelAsaasSubscription).not.toHaveBeenCalled();
      expect(tx.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-local-1' },
          data: expect.objectContaining({
            billingMode: 'ASAAS_INSTALLMENT',
            asaasInstallmentId: 'ins_novo',
            installmentCount: 12,
          }),
        }),
      );
      expect(tx.payment.create).toHaveBeenCalledTimes(12);
      expect(result.subscription).toMatchObject({
        cycle: 'YEARLY',
        installmentCount: 12,
      });
    });

    it('do anual não se evolui para o mensal', async () => {
      quoteService.quote.mockResolvedValue({
        ...evolutionQuote(),
        eligible: false,
        ineligibilityReason: 'ANNUAL_TO_MONTHLY_NOT_ALLOWED',
      });
      await expect(service.evolve(ADMIN, dto(), META)).rejects.toMatchObject({
        response: {
          code: 'PLAN_NOT_AVAILABLE',
          reason: 'ANNUAL_TO_MONTHLY_NOT_ALLOWED',
        },
      });
      expect(gateway.createInstallmentCharge).not.toHaveBeenCalled();
    });
  });
});
