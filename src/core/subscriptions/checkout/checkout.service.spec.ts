import { Test, TestingModule } from '@nestjs/testing';
import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from '../asaas-gateway.service';
import { SubscriptionQuoteService } from '../pricing/subscription-quote.service';
import { computeQuote } from '../pricing/pricing.engine';
import { CheckoutService } from './checkout.service';
import { CompanyRegistryService } from './company-registry.service';
import { ContractAcceptanceService } from './contract-acceptance.service';
import { CompanySessionService } from './company-session.service';

const ADMIN = { userId: 'user-1', companyId: 'company-1', isAdmin: true };
const META = { ip: '200.1.2.3', userAgent: 'jest' };
const TERMS = {
  id: 'contract-2',
  version: 2,
  html: '<p>termos</p>',
  sha256: 'abc',
};

// CPF 123.487.787-00 bate com a máscara publicada ***487787**.
const REGISTRY = {
  cnpj: '11222333000181',
  legalName: 'STUDIO NORTE ARQUITETURA LTDA',
  tradeName: 'Studio Norte',
  registrationStatus: 'ATIVA',
  isActive: true,
  address: {},
  partners: [
    {
      name: 'MARIA DA SILVA SOUZA',
      qualification: 'Sócio-Administrador',
      maskedDocument: '***487787**',
    },
  ],
  fetchedAt: '2026-09-22T12:00:00.000Z',
};

const START = {
  name: 'Atrupe Start',
  basePriceCents: 14700,
  additionalUserPriceCents: 1500,
};

const baseDto = (overrides: Record<string, any> = {}) => ({
  planId: 'plan-start',
  billingType: 'BOLETO' as const,
  contractor: {
    type: 'PJ' as const,
    cnpj: '11.222.333/0001-81',
    email: 'Financeiro@Studio.com',
  },
  representative: { cpf: '123.487.787-00', isSelf: true },
  termsAcceptance: { contractId: 'contract-2', version: 2, accepted: true },
  ...overrides,
});

describe('CheckoutService', () => {
  let service: CheckoutService;

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
    payment: { create: jest.fn() },
    subscriptionHistory: { create: jest.fn() },
    employee: { updateMany: jest.fn() },
    company: { updateMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((cb: any) => cb(tx)),
    plan: { findUniqueOrThrow: jest.fn() },
    feature: { findMany: jest.fn() },
    user: { findUniqueOrThrow: jest.fn() },
    coupon: { findUnique: jest.fn() },
    customer: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  };
  const gateway = {
    updateAsaasCustomer: jest.fn(),
    createAsaasCustomer: jest.fn(),
    createSubscription: jest.fn(),
    getAsaasSubscriptionPayments: jest.fn(),
    updateAsaasPayment: jest.fn(),
    getPixQrCode: jest.fn(),
    mapAsaasPaymentStatus: jest.fn(() => 'PENDING'),
    cancelAsaasSubscription: jest.fn(),
    createInstallmentCharge: jest.fn(),
    getInstallmentPayments: jest.fn(),
    deleteInstallment: jest.fn(),
    deleteAsaasPayment: jest.fn(),
  };
  const quoteService = { quote: jest.fn() };
  const registry = { lookup: jest.fn() };
  const acceptance = { currentTerms: jest.fn(), record: jest.fn() };
  const session = { build: jest.fn() };

  const eligible = (coupon?: any) => ({
    intent: 'NEW',
    eligible: true,
    plan: { id: 'plan-start', name: 'Atrupe Start', planType: 'START' },
    quote: computeQuote({ plan: START, cycle: 'MONTHLY', coupon }),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb: any) => cb(tx));
    tx.subscription.findFirst.mockResolvedValue(null);
    tx.subscription.create.mockResolvedValue({ id: 'sub-local-1' });
    tx.payment.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'pay-local-1', ...data }),
    );
    tx.couponUsage.deleteMany.mockResolvedValue({ count: 1 });
    prisma.plan.findUniqueOrThrow.mockResolvedValue({
      id: 'plan-start',
      name: 'Atrupe Start',
    });
    prisma.feature.findMany.mockResolvedValue([]);
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'user-1',
      name: 'Marcos',
      email: 'marcos@studio.com',
    });
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      asaasCustomerId: 'trial_x',
    });
    prisma.customer.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'cust-1', ...data }),
    );
    gateway.createAsaasCustomer.mockResolvedValue({ id: 'cus_123' });
    gateway.createSubscription.mockResolvedValue({
      id: 'sub_asaas_1',
      nextDueDate: '2026-09-24',
    });
    gateway.getAsaasSubscriptionPayments.mockResolvedValue([
      {
        id: 'pay_1',
        value: 147,
        dueDate: '2026-09-24',
        status: 'PENDING',
        invoiceUrl: 'https://asaas/i/1',
      },
    ]);
    quoteService.quote.mockResolvedValue(eligible());
    registry.lookup.mockResolvedValue(REGISTRY);
    acceptance.currentTerms.mockResolvedValue(TERMS);
    acceptance.record.mockResolvedValue({
      id: 'acc-1',
      version: 2,
      representativeVerified: true,
    });
    session.build.mockResolvedValue({ plan: { name: 'START', active: true } });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutService,
        { provide: PrismaService, useValue: prisma },
        { provide: AsaasGatewayService, useValue: gateway },
        { provide: SubscriptionQuoteService, useValue: quoteService },
        { provide: CompanyRegistryService, useValue: registry },
        { provide: ContractAcceptanceService, useValue: acceptance },
        { provide: CompanySessionService, useValue: session },
      ],
    }).compile();
    service = module.get(CheckoutService);
  });

  describe('quem pode contratar e o quê', () => {
    it('só administrador contrata', async () => {
      await expect(
        service.checkout({ ...ADMIN, isAdmin: false }, baseDto(), META),
      ).rejects.toThrow(ForbiddenException);
    });

    it('com a chave em "false", o anual não é oferecido', async () => {
      const original = process.env.ANNUAL_CYCLE_ENABLED;
      process.env.ANNUAL_CYCLE_ENABLED = 'false';
      await expect(
        service.checkout(ADMIN, baseDto({ cycle: 'YEARLY' }), META),
      ).rejects.toMatchObject({ response: { code: 'CYCLE_NOT_AVAILABLE' } });
      process.env.ANNUAL_CYCLE_ENABLED = original;
    });

    it('com cobrança em aberto, pede regularização', async () => {
      quoteService.quote.mockResolvedValue({
        ...eligible(),
        intent: 'REGULARIZATION',
        eligible: false,
      });
      await expect(
        service.checkout(ADMIN, baseDto(), META),
      ).rejects.toMatchObject({
        response: { code: 'REGULARIZATION_REQUIRED' },
      });
    });

    it('recusa se o preço mudou desde o resumo exibido', async () => {
      await expect(
        service.checkout(ADMIN, baseDto({ expectedTotalCents: 9999 }), META),
      ).rejects.toMatchObject({ response: { code: 'PRICE_CHANGED' } });
      expect(gateway.createSubscription).not.toHaveBeenCalled();
    });

    it('recusa aceite de uma versão que não é a vigente', async () => {
      await expect(
        service.checkout(
          ADMIN,
          baseDto({
            termsAcceptance: {
              contractId: 'contract-1',
              version: 1,
              accepted: true,
            },
          }),
          META,
        ),
      ).rejects.toMatchObject({ response: { code: 'TERMS_OUTDATED' } });
    });
  });

  describe('representante legal', () => {
    it('CPF fora do quadro societário bloqueia, sem tocar no gateway', async () => {
      await expect(
        service.checkout(
          ADMIN,
          baseDto({ representative: { cpf: '529.982.247-25', isSelf: false } }),
          META,
        ),
      ).rejects.toMatchObject({
        response: { code: 'REPRESENTATIVE_NOT_IN_REGISTRY' },
      });
      expect(gateway.createAsaasCustomer).not.toHaveBeenCalled();
      expect(tx.subscription.create).not.toHaveBeenCalled();
    });

    it('sem quadro para conferir, exige o nome', async () => {
      registry.lookup.mockResolvedValue({ ...REGISTRY, partners: [] });
      await expect(
        service.checkout(ADMIN, baseDto(), META),
      ).rejects.toMatchObject({
        response: { code: 'REPRESENTATIVE_NAME_REQUIRED' },
      });
    });

    it('sem quadro, aceita o nome informado e registra que não houve conferência', async () => {
      registry.lookup.mockResolvedValue({ ...REGISTRY, partners: [] });
      await service.checkout(
        ADMIN,
        baseDto({
          representative: {
            cpf: '123.487.787-00',
            name: 'Maria S.',
            isSelf: false,
          },
        }),
        META,
      );
      const [, input] = acceptance.record.mock.calls[0];
      expect(input.representative).toEqual({
        cpf: '12348778700',
        name: 'Maria S.',
        verified: false,
        isSessionUser: false,
      });
    });
  });

  describe('contratação que dá certo', () => {
    it('registra, libera o acesso e devolve a fatura', async () => {
      const result = await service.checkout(ADMIN, baseDto(), META);

      // A assinatura nasce no Asaas com o valor cheio da renovação.
      expect(gateway.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_123',
          value: 147,
          cycle: 'MONTHLY',
          externalReference: 'sub-local-1',
        }),
      );
      // Contratação registrada libera o acesso: ACTIVE, com data de contratação.
      expect(tx.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-local-1' },
          data: expect.objectContaining({
            status: 'ACTIVE',
            contractedAt: expect.any(Date),
          }),
        }),
      );
      expect(result.paymentUrl).toBe('https://asaas/i/1');
      expect(result.session).toEqual({ plan: { name: 'START', active: true } });
    });

    it('o aceite leva o nome publicado no registro, conferido', async () => {
      await service.checkout(ADMIN, baseDto(), META);
      const [, input] = acceptance.record.mock.calls[0];
      expect(input).toMatchObject({
        context: 'NEW_CONTRACT',
        contractor: {
          type: 'PJ',
          document: '11222333000181',
          name: 'STUDIO NORTE ARQUITETURA LTDA',
          email: 'financeiro@studio.com',
        },
        representative: {
          cpf: '12348778700',
          name: 'MARIA DA SILVA SOUZA',
          verified: true,
          isSessionUser: true,
        },
        ipAddress: '200.1.2.3',
      });
    });

    it('"sou eu" grava o CPF no cadastro de quem contratou, sem sobrescrever', async () => {
      await service.checkout(ADMIN, baseDto(), META);
      expect(tx.employee.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', userId: 'user-1', cpf: null },
        data: { cpf: '12348778700' },
      });
    });

    it('cupom abate só a primeira cobrança', async () => {
      const cupom = {
        code: 'ATRUPE20',
        discountType: 'PERCENT',
        discountValue: 20,
      };
      quoteService.quote.mockResolvedValue(eligible(cupom));
      prisma.coupon.findUnique.mockResolvedValue({
        id: 'coupon-1',
        discountType: 'PERCENT',
      });
      gateway.updateAsaasPayment.mockResolvedValue({ value: 117.6 });

      await service.checkout(ADMIN, baseDto({ couponCode: 'ATRUPE20' }), META);

      expect(gateway.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ value: 147 }),
      );
      expect(gateway.updateAsaasPayment).toHaveBeenCalledWith('pay_1', {
        value: 117.6,
      });
    });
  });

  describe('compensação', () => {
    it('falha no gateway cancela a assinatura criada e desfaz a reserva', async () => {
      const cupom = {
        code: 'ATRUPE20',
        discountType: 'PERCENT',
        discountValue: 20,
      };
      quoteService.quote.mockResolvedValue(eligible(cupom));
      prisma.coupon.findUnique.mockResolvedValue({
        id: 'coupon-1',
        discountType: 'PERCENT',
      });
      gateway.updateAsaasPayment.mockRejectedValue(
        new Error('Asaas fora do ar'),
      );

      await expect(
        service.checkout(ADMIN, baseDto({ couponCode: 'ATRUPE20' }), META),
      ).rejects.toThrow(BadGatewayException);

      expect(gateway.cancelAsaasSubscription).toHaveBeenCalledWith(
        'sub_asaas_1',
      );
      expect(tx.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-local-1' },
        data: { status: 'CANCELED', endedReason: 'ABANDONED' },
      });
      expect(tx.coupon.update).toHaveBeenLastCalledWith({
        where: { id: 'coupon-1' },
        data: { currentUses: { decrement: 1 } },
      });
    });

    it('sessão indisponível depois da ativação NÃO desfaz a contratação', async () => {
      session.build.mockRejectedValue(new Error('sessão lenta'));

      const result = await service.checkout(ADMIN, baseDto(), META);

      expect(result.session).toBeNull();
      expect(gateway.cancelAsaasSubscription).not.toHaveBeenCalled();
    });

    it('contratação em andamento na mesma empresa é recusada', async () => {
      tx.subscription.findFirst.mockResolvedValueOnce({ id: 'outra' });
      await expect(service.checkout(ADMIN, baseDto(), META)).rejects.toThrow(
        ConflictException,
      );
      expect(gateway.createSubscription).not.toHaveBeenCalled();
    });
  });

  it('pessoa física não tem representante', async () => {
    await service.checkout(
      ADMIN,
      baseDto({
        contractor: {
          type: 'PF',
          cpf: '529.982.247-25',
          name: 'Marcos Souza',
          email: 'marcos@x.com',
        },
        representative: undefined,
      }),
      META,
    );
    const [, input] = acceptance.record.mock.calls[0];
    expect(input.contractor).toMatchObject({
      type: 'PF',
      document: '52998224725',
    });
    expect(input.representative).toBeNull();
    expect(registry.lookup).not.toHaveBeenCalled();
  });

  it('valor abaixo do mínimo do gateway é recusado antes de criar qualquer coisa', async () => {
    const tudo = { code: 'TUDO', discountType: 'VALUE', discountValue: 14700 };
    quoteService.quote.mockResolvedValue(eligible(tudo));
    await expect(service.checkout(ADMIN, baseDto(), META)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(tx.subscription.create).not.toHaveBeenCalled();
  });

  describe('ciclo anual', () => {
    const original = process.env.ANNUAL_CYCLE_ENABLED;
    beforeEach(() => {
      process.env.ANNUAL_CYCLE_ENABLED = 'true';
    });
    afterEach(() => {
      process.env.ANNUAL_CYCLE_ENABLED = original;
    });

    // Start anual: 147 × 11 = 1.617.
    const anual = (billingType: string, installmentCount = 1) => ({
      ...eligible(),
      quote: computeQuote({
        plan: START,
        cycle: 'YEARLY',
        billingType,
        installmentCount,
      }),
    });
    const dozeParcelas = () =>
      Array.from({ length: 12 }, (_, i) => ({
        id: 'pay_' + (i + 1),
        value: 134.75,
        dueDate: '2026-09-24',
        status: 'PENDING',
        installment: 'ins_1',
        installmentNumber: i + 1,
        invoiceUrl: 'https://asaas/i/' + (i + 1),
      }));
    const anualEm12x = () =>
      baseDto({
        cycle: 'YEARLY',
        billingType: 'CREDIT_CARD',
        installmentCount: 12,
      });

    it('anual à vista vira assinatura anual, com um ano de período', async () => {
      quoteService.quote.mockResolvedValue(anual('PIX'));
      gateway.getAsaasSubscriptionPayments.mockResolvedValue([
        {
          id: 'pay_1',
          value: 1617,
          dueDate: '2026-09-24',
          status: 'PENDING',
          invoiceUrl: 'https://asaas/i/1',
        },
      ]);

      await service.checkout(
        ADMIN,
        baseDto({ cycle: 'YEARLY', billingType: 'PIX' }),
        META,
      );

      expect(gateway.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ cycle: 'YEARLY', value: 1617 }),
      );
      expect(tx.subscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ cycle: 'YEARLY' }),
      });
      const payment = tx.payment.create.mock.calls[0][0].data;
      expect(payment.periodEnd.toISOString().slice(0, 10)).toBe('2027-09-24');
    });

    it('anual em 12x no cartão vira parcelamento, com uma cobrança por parcela', async () => {
      quoteService.quote.mockResolvedValue(anual('CREDIT_CARD', 12));
      gateway.createInstallmentCharge.mockResolvedValue({
        id: 'pay_1',
        installment: 'ins_1',
      });
      gateway.getInstallmentPayments.mockResolvedValue(dozeParcelas());

      const result = await service.checkout(ADMIN, anualEm12x(), META);

      expect(gateway.createSubscription).not.toHaveBeenCalled();
      expect(gateway.createInstallmentCharge).toHaveBeenCalledWith(
        expect.objectContaining({ installmentCount: 12, totalValue: 1617 }),
      );
      expect(tx.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-local-1' },
          data: expect.objectContaining({
            asaasSubscriptionId: 'inst_sub-local-1',
            asaasInstallmentId: 'ins_1',
            billingMode: 'ASAAS_INSTALLMENT',
            installmentCount: 12,
            status: 'ACTIVE',
          }),
        }),
      );
      expect(tx.payment.create).toHaveBeenCalledTimes(12);
      expect(result.paymentUrl).toBe('https://asaas/i/1');
      expect(result.subscription).toMatchObject({
        cycle: 'YEARLY',
        installmentCount: 12,
      });
    });

    it('falha ao registrar desfaz o parcelamento no Asaas', async () => {
      quoteService.quote.mockResolvedValue(anual('CREDIT_CARD', 12));
      gateway.createInstallmentCharge.mockResolvedValue({
        id: 'pay_1',
        installment: 'ins_1',
      });
      gateway.getInstallmentPayments.mockResolvedValue(dozeParcelas());
      acceptance.record.mockRejectedValue(new Error('banco fora'));

      await expect(service.checkout(ADMIN, anualEm12x(), META)).rejects.toThrow(
        BadGatewayException,
      );
      expect(gateway.deleteInstallment).toHaveBeenCalledWith('ins_1');
      expect(gateway.cancelAsaasSubscription).not.toHaveBeenCalled();
    });

    it('com a chave desligada, o anual não é contratável', async () => {
      process.env.ANNUAL_CYCLE_ENABLED = 'false';
      await expect(
        service.checkout(ADMIN, anualEm12x(), META),
      ).rejects.toMatchObject({ response: { code: 'CYCLE_NOT_AVAILABLE' } });
    });
  });

  it('parcelas no mensal são recusadas antes de criar qualquer coisa', async () => {
    await expect(
      service.checkout(ADMIN, baseDto({ installmentCount: 3 }), META),
    ).rejects.toMatchObject({
      response: { code: 'INSTALLMENTS_NOT_AVAILABLE' },
    });
    expect(tx.subscription.create).not.toHaveBeenCalled();
  });
});
