import { Test, TestingModule } from '@nestjs/testing';
import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from '../asaas-gateway.service';
import { SubscriptionQuoteService } from '../pricing/subscription-quote.service';
import { ContractAcceptanceService } from './contract-acceptance.service';
import { CompanySessionService } from './company-session.service';
import { ComplementsService } from './complements.service';

const ADMIN = { userId: 'user-1', companyId: 'company-1', isAdmin: true };
const META = { ip: '200.1.2.3', userAgent: 'jest' };
const TERMS = { id: 'contract-2', version: 2, html: '<p>t</p>', sha256: 'abc' };
const ACCEPT = { contractId: 'contract-2', version: 2, accepted: true };
const PROXIMA_RENOVACAO = new Date('2099-01-15T00:00:00.000Z');

const NOTA_FISCAL = {
  id: 'feat-nf',
  key: 'nota_fiscal',
  name: 'Nota Fiscal',
  description: 'NF-e, NFS-e e NFC-e',
  price: 7000,
  isActive: true,
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

const startSubscription = (overrides: Record<string, any> = {}) => ({
  id: 'sub-1',
  status: 'ACTIVE',
  planId: 'plan-start',
  cycle: 'MONTHLY',
  billingType: 'BOLETO',
  asaasSubscriptionId: 'sub_1',
  value: 147,
  recurringValueCents: 14700,
  additionalUsers: 0,
  nextDueDate: new Date('2099-02-15T00:00:00.000Z'),
  customer: {
    document: '11222333000181',
    name: 'STUDIO NORTE ARQUITETURA LTDA',
    email: 'financeiro@studio.com',
  },
  plan: {
    name: 'Atrupe Start',
    planType: 'START',
    additionalUserPrice: 1500,
    planFeatures: [{ feature: { key: 'orcamentos' } }],
  },
  subscriptionFeatures: [],
  ...overrides,
});

const comNotaFiscal = {
  value: 217,
  recurringValueCents: 21700,
  subscriptionFeatures: [
    { id: 'sf-nf', isActive: true, price: 7000, feature: NOTA_FISCAL },
  ],
};

describe('ComplementsService', () => {
  let service: ComplementsService;

  const tx = {
    $executeRaw: jest.fn(),
    subscription: { findFirst: jest.fn(), update: jest.fn() },
    subscriptionFeature: { upsert: jest.fn(), delete: jest.fn() },
    payment: { updateMany: jest.fn() },
    subscriptionHistory: { create: jest.fn() },
    contractAcceptance: { findFirst: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((cb: any) => cb(tx)),
    subscription: { findUniqueOrThrow: jest.fn() },
    feature: { findMany: jest.fn() },
    contractAcceptance: { findFirst: jest.fn() },
    user: { findUniqueOrThrow: jest.fn() },
    company: { findUnique: jest.fn() },
  };
  const gateway = {
    getAsaasSubscription: jest.fn(),
    getAsaasSubscriptionPayments: jest.fn(),
    updateAsaasSubscription: jest.fn(),
    updateAsaasPayment: jest.fn(),
  };
  const quoteService = { getBillingContext: jest.fn() };
  const acceptance = { currentTerms: jest.fn(), record: jest.fn() };
  const session = { build: jest.fn() };

  const withSubscription = (
    sub = startSubscription(),
    ctx: Record<string, any> = {},
  ) => {
    prisma.subscription.findUniqueOrThrow.mockResolvedValue(sub);
    // No Asaas, a mesma mensalidade que o banco registra.
    gateway.getAsaasSubscription.mockResolvedValue({
      status: 'ACTIVE',
      value: sub.value,
    });
    quoteService.getBillingContext.mockResolvedValue({
      intent: 'EVOLUTION',
      hasOpenCharge: false,
      current: {
        id: sub.id,
        payments: [{ status: 'PENDING', dueDate: PROXIMA_RENOVACAO }],
      },
      ...ctx,
    });
  };

  const withGatewayPayments = (payments: any[]) =>
    gateway.getAsaasSubscriptionPayments.mockResolvedValue(payments);

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb: any) => cb(tx));
    tx.subscription.findFirst.mockResolvedValue(null);
    tx.subscription.update.mockResolvedValue({ id: 'sub-1' });
    tx.contractAcceptance.findFirst.mockResolvedValue(LAST_ACCEPTANCE);
    prisma.feature.findMany.mockResolvedValue([NOTA_FISCAL]);
    // O ADMIN é o administrador principal da conta (Usuário nº 1).
    prisma.company.findUnique.mockResolvedValue({ ownerUserId: 'user-1' });
    prisma.contractAcceptance.findFirst.mockResolvedValue(LAST_ACCEPTANCE);
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'user-1',
      name: 'Marcos',
      email: 'marcos@studio.com',
    });
    withSubscription();
    withGatewayPayments([
      // A próxima mensalidade, que o Asaas já gerou.
      { id: 'pay_next', value: 147, dueDate: '2099-01-15', status: 'PENDING' },
      { id: 'pay_paid', value: 147, dueDate: '2000-01-15', status: 'RECEIVED' },
    ]);
    gateway.updateAsaasSubscription.mockResolvedValue({});
    gateway.updateAsaasPayment.mockResolvedValue({});
    acceptance.currentTerms.mockResolvedValue(TERMS);
    acceptance.record.mockResolvedValue({ id: 'acc-1' });
    session.build.mockResolvedValue({ plan: { name: 'START', active: true } });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AsaasGatewayService, useValue: gateway },
        { provide: SubscriptionQuoteService, useValue: quoteService },
        { provide: ContractAcceptanceService, useValue: acceptance },
        { provide: CompanySessionService, useValue: session },
      ],
    }).compile();
    service = module.get(ComplementsService);
  });

  describe('o que está contratado', () => {
    it('recurso avulso que saiu de venda não segue para a evolução', async () => {
      withSubscription(
        startSubscription({
          subscriptionFeatures: [
            ...comNotaFiscal.subscriptionFeatures,
            {
              id: 'sf-velho',
              isActive: true,
              price: 2000,
              feature: {
                key: 'modulo_antigo',
                name: 'Antigo',
                price: 2000,
                isActive: false,
              },
            },
          ],
        }),
      );
      const view: any = await service.current('company-1');
      expect(view.subscription.modules.map((m) => m.key)).toEqual([
        'nota_fiscal',
      ]);
    });

    it('mostra os módulos contratados, os que dá para incluir e quando entram', async () => {
      withSubscription(startSubscription(comNotaFiscal));
      prisma.feature.findMany.mockResolvedValue([
        NOTA_FISCAL,
        { id: 'f-orc', key: 'orcamentos', name: 'Orçamentos', price: 5000 },
        { id: 'f-pdv', key: 'pdv', name: 'PDV', price: 3000 },
      ]);

      const view: any = await service.current('company-1');

      expect(view).toMatchObject({
        intent: 'EVOLUTION',
        restriction: null,
        subscription: {
          recurringCents: 21700,
          nextChargeDate: PROXIMA_RENOVACAO.toISOString(),
          modules: [{ key: 'nota_fiscal', priceCents: 7000 }],
          additionalUserPriceCents: 1500,
        },
        contractor: { type: 'PJ', name: 'STUDIO NORTE ARQUITETURA LTDA' },
        terms: { id: 'contract-2', version: 2 },
      });
      // Nem o que já está contratado nem o que o plano já inclui.
      expect(view.availableModules.map((m) => m.key)).toEqual(['pdv']);
    });

    it('com cobrança em aberto, avisa que não dá para alterar agora', async () => {
      withSubscription(startSubscription(), {
        intent: 'REGULARIZATION',
        hasOpenCharge: true,
      });
      const view: any = await service.current('company-1');
      expect(view.restriction).toBe('OPEN_CHARGE');
    });
  });

  describe('inclusão', () => {
    it('o Asaas cobra outro valor que o registrado: recusa sem mexer em nada', async () => {
      // O banco diz 147, o Asaas cobra 217: somar a NF sobre 147 erraria.
      gateway.getAsaasSubscription.mockResolvedValue({
        status: 'ACTIVE',
        value: 217,
      });

      await expect(
        service.apply(
          ADMIN,
          { modules: ['nota_fiscal'], termsAcceptance: ACCEPT } as any,
          META,
        ),
      ).rejects.toMatchObject({ response: { code: 'BILLING_OUT_OF_SYNC' } });
      expect(gateway.updateAsaasSubscription).not.toHaveBeenCalled();
      expect(gateway.updateAsaasPayment).not.toHaveBeenCalled();
      expect(tx.subscription.update).not.toHaveBeenCalled();
    });

    it('assinatura removida no Asaas: recusa', async () => {
      gateway.getAsaasSubscription.mockResolvedValue({
        status: 'ACTIVE',
        value: 147,
        deleted: true,
      });

      await expect(
        service.apply(
          ADMIN,
          { modules: ['nota_fiscal'], termsAcceptance: ACCEPT } as any,
          META,
        ),
      ).rejects.toMatchObject({ response: { code: 'BILLING_OUT_OF_SYNC' } });
    });
    it('contratar complementos é do Usuário nº 1: outro administrador é recusado (contrato, 4.2)', async () => {
      await expect(
        service.apply(
          { ...ADMIN, userId: 'outro-admin' },
          { modules: ['nota_fiscal'], termsAcceptance: ACCEPT } as any,
          META,
        ),
      ).rejects.toMatchObject({ response: { code: 'OWNER_ONLY' } });
      expect(gateway.updateAsaasSubscription).not.toHaveBeenCalled();
    });

    it('orça: nada agora, e a mensalidade passa de 147 para 217', async () => {
      const quote = await service.quote('company-1', {
        modules: ['nota_fiscal'],
      });
      expect(quote).toMatchObject({
        chargedNowCents: 0,
        currentRecurringCents: 14700,
        recurringCents: 21700,
        nextChargeDate: PROXIMA_RENOVACAO.toISOString(),
      });
    });

    it('inclui: a assinatura e a mensalidade já gerada passam a cobrar o módulo', async () => {
      const result = await service.apply(
        ADMIN,
        { modules: ['nota_fiscal'], termsAcceptance: ACCEPT },
        META,
      );

      expect(gateway.updateAsaasSubscription).toHaveBeenCalledWith('sub_1', {
        value: 217,
        updatePendingPayments: false,
      });
      expect(gateway.updateAsaasPayment).toHaveBeenCalledTimes(1);
      expect(gateway.updateAsaasPayment).toHaveBeenCalledWith('pay_next', {
        value: 217,
      });
      expect(tx.subscriptionFeature.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            featureId: 'feat-nf',
            price: 7000,
          }),
        }),
      );
      expect(tx.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: { additionalUsers: 0, value: 217, recurringValueCents: 21700 },
        }),
      );
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { asaasPaymentId: 'pay_next' },
        data: { value: 217 },
      });
      expect(tx.subscriptionHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'COMPLEMENTS_ADDED' }),
      });
      const [, input] = acceptance.record.mock.calls[0];
      expect(input).toMatchObject({
        context: 'COMPLEMENTS',
        subscriptionId: 'sub-1',
        contractor: { document: '11222333000181' },
      });
      expect(result).toMatchObject({
        chargedNowCents: 0,
        recurringCents: 21700,
      });
    });

    it('usuários adicionais entram pela quantidade nova', async () => {
      await service.apply(
        ADMIN,
        { additionalUsers: 2, termsAcceptance: ACCEPT },
        META,
      );
      expect(gateway.updateAsaasSubscription).toHaveBeenCalledWith('sub_1', {
        value: 177,
        updatePendingPayments: false,
      });
      expect(tx.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ additionalUsers: 2, value: 177 }),
        }),
      );
    });

    it('parte da mensalidade atual: desconto antigo da assinatura continua', async () => {
      withSubscription(
        startSubscription({ value: 117.6, recurringValueCents: null }),
      );
      await service.apply(
        ADMIN,
        { modules: ['nota_fiscal'], termsAcceptance: ACCEPT },
        META,
      );
      expect(gateway.updateAsaasSubscription).toHaveBeenCalledWith('sub_1', {
        value: 187.6,
        updatePendingPayments: false,
      });
      // Assinatura antiga não ganha o campo novo: a rotina de cupom antiga
      // depende de ele estar vazio.
      expect(tx.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { additionalUsers: 0, value: 187.6 },
        }),
      );
    });

    it('só administrador inclui complementos', async () => {
      await expect(
        service.apply(
          { ...ADMIN, isAdmin: false },
          { modules: ['nota_fiscal'], termsAcceptance: ACCEPT },
          META,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it.each([
      [
        'módulo já contratado',
        () => withSubscription(startSubscription(comNotaFiscal)),
        { modules: ['nota_fiscal'] },
        'MODULE_ALREADY_CONTRACTED',
      ],
      [
        'módulo que o plano já inclui',
        () => undefined,
        { modules: ['orcamentos'] },
        'MODULE_INCLUDED_IN_PLAN',
      ],
      ['nada escolhido', () => undefined, {}, 'NOTHING_TO_CHANGE'],
      [
        'menos usuários do que já tem',
        () => withSubscription(startSubscription({ additionalUsers: 3 })),
        { additionalUsers: 1 },
        'USERS_REDUCTION_NOT_AVAILABLE',
      ],
      [
        'plano anual',
        () => withSubscription(startSubscription({ cycle: 'YEARLY' })),
        { modules: ['nota_fiscal'] },
        'COMPLEMENTS_NOT_AVAILABLE',
      ],
    ])('recusa %s', async (_, arrange, request, code) => {
      arrange();
      await expect(
        service.apply(ADMIN, { ...request, termsAcceptance: ACCEPT }, META),
      ).rejects.toMatchObject({ response: { code } });
      expect(gateway.updateAsaasSubscription).not.toHaveBeenCalled();
    });

    it('com cobrança em aberto, pede regularização antes', async () => {
      withSubscription(startSubscription(), {
        intent: 'REGULARIZATION',
        hasOpenCharge: true,
      });
      await expect(
        service.apply(
          ADMIN,
          { modules: ['nota_fiscal'], termsAcceptance: ACCEPT },
          META,
        ),
      ).rejects.toMatchObject({
        response: { code: 'REGULARIZATION_REQUIRED' },
      });
      expect(gateway.updateAsaasSubscription).not.toHaveBeenCalled();
    });

    it('cobrança vencida no Asaas que o banco não viu também pede regularização', async () => {
      withGatewayPayments([
        { id: 'pay_due', value: 147, dueDate: '2000-01-15', status: 'OVERDUE' },
      ]);
      await expect(
        service.apply(
          ADMIN,
          { modules: ['nota_fiscal'], termsAcceptance: ACCEPT },
          META,
        ),
      ).rejects.toMatchObject({
        response: { code: 'REGULARIZATION_REQUIRED' },
      });
      expect(gateway.updateAsaasSubscription).not.toHaveBeenCalled();
    });

    it('contratação em andamento vai substituir a assinatura: espera', async () => {
      tx.subscription.findFirst.mockResolvedValue({ id: 'sub-temp' });
      await expect(
        service.apply(
          ADMIN,
          { modules: ['nota_fiscal'], termsAcceptance: ACCEPT },
          META,
        ),
      ).rejects.toMatchObject({ response: { code: 'CHECKOUT_IN_PROGRESS' } });
    });

    it('valor que mudou desde o resumo é recusado', async () => {
      await expect(
        service.apply(
          ADMIN,
          {
            modules: ['nota_fiscal'],
            expectedRecurringCents: 20000,
            termsAcceptance: ACCEPT,
          },
          META,
        ),
      ).rejects.toMatchObject({
        response: { code: 'PRICE_CHANGED', quote: { recurringCents: 21700 } },
      });
    });
  });

  describe('quando o gateway ou o banco falham', () => {
    const include = () =>
      service.apply(
        ADMIN,
        { modules: ['nota_fiscal'], termsAcceptance: ACCEPT },
        META,
      );

    it('Asaas recusa a assinatura: nada é registrado', async () => {
      gateway.updateAsaasSubscription.mockRejectedValue(new Error('fora'));
      await expect(include()).rejects.toThrow(BadGatewayException);
      expect(tx.subscriptionFeature.upsert).not.toHaveBeenCalled();
    });

    it('Asaas recusa a mensalidade já gerada: o valor da assinatura volta', async () => {
      gateway.updateAsaasPayment.mockRejectedValue(new Error('fora'));
      await expect(include()).rejects.toThrow(BadGatewayException);
      expect(gateway.updateAsaasSubscription).toHaveBeenLastCalledWith(
        'sub_1',
        { value: 147, updatePendingPayments: false },
      );
      expect(tx.subscriptionFeature.upsert).not.toHaveBeenCalled();
    });

    it('banco falha depois do Asaas: o Asaas é desfeito', async () => {
      tx.subscription.update.mockRejectedValue(new Error('deadlock'));
      await expect(include()).rejects.toThrow('deadlock');
      expect(gateway.updateAsaasPayment).toHaveBeenLastCalledWith('pay_next', {
        value: 147,
      });
      expect(gateway.updateAsaasSubscription).toHaveBeenLastCalledWith(
        'sub_1',
        { value: 147, updatePendingPayments: false },
      );
      expect(acceptance.record).not.toHaveBeenCalled();
    });
  });

  describe('retirar módulo', () => {
    it('retirar módulo tira o valor das mensalidades não pagas e o acesso', async () => {
      withSubscription(startSubscription(comNotaFiscal));
      withGatewayPayments([
        {
          id: 'pay_next',
          value: 217,
          dueDate: '2099-01-15',
          status: 'PENDING',
        },
      ]);

      await service.removeModule(ADMIN, 'sub-1', 'nota_fiscal');

      expect(gateway.updateAsaasSubscription).toHaveBeenCalledWith('sub_1', {
        value: 147,
        updatePendingPayments: false,
      });
      expect(gateway.updateAsaasPayment).toHaveBeenCalledWith('pay_next', {
        value: 147,
      });
      expect(tx.subscriptionFeature.delete).toHaveBeenCalledWith({
        where: { id: 'sf-nf' },
      });
      expect(tx.subscriptionHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'MODULE_REMOVED' }),
      });
    });

    it('retirar com cobrança vencida é permitido e não mexe na vencida', async () => {
      withSubscription(startSubscription(comNotaFiscal), {
        intent: 'REGULARIZATION',
        hasOpenCharge: true,
      });
      withGatewayPayments([
        { id: 'pay_due', value: 217, dueDate: '2000-01-15', status: 'OVERDUE' },
      ]);

      await service.removeModule(ADMIN, 'sub-1', 'nota_fiscal');

      expect(gateway.updateAsaasSubscription).toHaveBeenCalledWith('sub_1', {
        value: 147,
        updatePendingPayments: false,
      });
      expect(gateway.updateAsaasPayment).not.toHaveBeenCalled();
    });

    it('só administrador retira módulo', async () => {
      await expect(
        service.removeModule(
          { ...ADMIN, isAdmin: false },
          'sub-1',
          'nota_fiscal',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
