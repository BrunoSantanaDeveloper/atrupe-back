import { Test, TestingModule } from '@nestjs/testing';
import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from '../asaas-gateway.service';
import { SubscriptionQuoteService } from '../pricing/subscription-quote.service';
import { ContractAcceptanceService } from './contract-acceptance.service';
import { CompanySessionService } from './company-session.service';
import { RegularizationService } from './regularization.service';

const ADMIN = { userId: 'user-1', companyId: 'company-1', isAdmin: true };
const META = { ip: '200.1.2.3', userAgent: 'jest' };
const TERMS = { id: 'contract-2', version: 2, html: '<p>t</p>', sha256: 'abc' };
const ACCEPT = { contractId: 'contract-2', version: 2, accepted: true };

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

describe('RegularizationService', () => {
  let service: RegularizationService;

  const tx = { subscriptionHistory: { create: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((cb: any) => cb(tx)),
    contractAcceptance: { findFirst: jest.fn() },
    customer: { findUnique: jest.fn() },
    payment: { updateMany: jest.fn() },
    user: { findUniqueOrThrow: jest.fn() },
  };
  const gateway = { updateAsaasPayment: jest.fn(), getPixQrCode: jest.fn() };
  const quoteService = { getBillingContext: jest.fn() };
  const acceptance = { currentTerms: jest.fn(), record: jest.fn() };
  const session = { build: jest.fn() };

  const withOpenCharge = (dueDate: string, billingType = 'BOLETO') => {
    quoteService.getBillingContext.mockResolvedValue({
      hasOpenCharge: true,
      hasOverdue: true,
      firstChargePending: false,
      current: {
        id: 'sub-1',
        customerId: 'cust-1',
        cycle: 'MONTHLY',
        billingType,
        value: 147,
        plan: { name: 'Atrupe Start' },
      },
    });
    session.build.mockResolvedValue({
      billing: {
        situation: 'ATRASADA',
        daysOverdue: 3,
        chargeInFocus: {
          asaasPaymentId: 'pay_1',
          dueDate: `${dueDate}T00:00:00.000Z`,
          value: 147,
          billingType,
          status: 'OVERDUE',
          invoiceUrl: 'https://asaas/i/1',
        },
      },
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb: any) => cb(tx));
    acceptance.currentTerms.mockResolvedValue(TERMS);
    acceptance.record.mockResolvedValue({ id: 'acc-2' });
    prisma.contractAcceptance.findFirst.mockResolvedValue(LAST_ACCEPTANCE);
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'user-1',
      name: 'Marcos',
      email: 'm@x.com',
    });
    gateway.updateAsaasPayment.mockResolvedValue({
      invoiceUrl: 'https://asaas/i/1-novo',
    });
    gateway.getPixQrCode.mockResolvedValue({
      encodedImage: 'img',
      payload: 'copia-e-cola',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegularizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AsaasGatewayService, useValue: gateway },
        { provide: SubscriptionQuoteService, useValue: quoteService },
        { provide: ContractAcceptanceService, useValue: acceptance },
        { provide: CompanySessionService, useValue: session },
      ],
    }).compile();
    service = module.get(RegularizationService);
  });

  it('sem cobrança em aberto, nada a regularizar', async () => {
    quoteService.getBillingContext.mockResolvedValue({
      hasOpenCharge: false,
      current: null,
    });
    await expect(service.view('company-1')).resolves.toEqual({
      required: false,
    });
  });

  it('mostra o contratante do último aceite, em leitura', async () => {
    withOpenCharge('2026-01-10');
    const view: any = await service.view('company-1');
    expect(view).toMatchObject({
      required: true,
      reason: 'OVERDUE',
      contractor: {
        type: 'PJ',
        document: '11222333000181',
        representativeName: 'MARIA DA SILVA SOUZA',
      },
      terms: { id: 'contract-2', version: 2 },
    });
  });

  it('evolução que espera o pagamento: a regularização é dela, com o plano novo', async () => {
    withOpenCharge('2099-01-10');
    const ctx = await quoteService.getBillingContext();
    quoteService.getBillingContext.mockResolvedValue({
      ...ctx,
      hasOverdue: false,
      evolutionPending: true,
      pendingEvolution: {
        id: 'sub-lite',
        customerId: 'cust-1',
        cycle: 'MONTHLY',
        billingType: 'PIX',
        value: 230,
        plan: { name: 'Atrupe Lite' },
      },
    });

    const view: any = await service.view('company-1');

    expect(view.reason).toBe('EVOLUTION_PENDING');
    expect(view.subscription).toMatchObject({
      id: 'sub-lite',
      planName: 'Atrupe Lite',
      valueCents: 23000,
    });
  });

  it('contratação que espera o pagamento, mesmo vencida, não é mensalidade atrasada', async () => {
    withOpenCharge('2026-01-10');
    const ctx = await quoteService.getBillingContext();
    quoteService.getBillingContext.mockResolvedValue({
      ...ctx,
      awaitingActivation: true,
    });

    const view: any = await service.view('company-1');

    expect(view.reason).toBe('CHECKOUT_PENDING');
    expect(view.chargeInFocus.asaasPaymentId).toBe('pay_1');
  });

  it('reemite a vencida para hoje na forma escolhida, e pede o aceite de novo', async () => {
    withOpenCharge('2026-01-10', 'BOLETO');
    const today = new Date().toISOString().split('T')[0];

    const result = await service.pay(
      ADMIN,
      { billingType: 'PIX', termsAcceptance: ACCEPT },
      META,
    );

    expect(gateway.updateAsaasPayment).toHaveBeenCalledWith('pay_1', {
      billingType: 'PIX',
      dueDate: today,
    });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { asaasPaymentId: 'pay_1' },
        data: expect.objectContaining({
          billingType: 'PIX',
          status: 'PENDING',
          pixCopyPaste: 'copia-e-cola',
        }),
      }),
    );
    // Reemitir não é pagar: no banco a cobrança segue com o vencimento de
    // antes, e é dele que o atraso conta até o pagamento.
    const [{ data }] = prisma.payment.updateMany.mock.calls[0];
    expect(data).not.toHaveProperty('dueDate');
    expect(tx.subscriptionHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'REGULARIZATION_STARTED',
        metadata: expect.objectContaining({
          paymentId: 'pay_1',
          dueDate: today,
          originalDueDate: '2026-01-10',
        }),
      }),
    });
    const [, input] = acceptance.record.mock.calls[0];
    expect(input).toMatchObject({
      context: 'REGULARIZATION',
      subscriptionId: 'sub-1',
      representative: {
        cpf: '12348778700',
        name: 'MARIA DA SILVA SOUZA',
        verified: true,
        isSessionUser: true,
      },
    });
    expect(result.paymentUrl).toBe('https://asaas/i/1-novo');
  });

  it('contratação que espera o pagamento: a reemitida vale com o vencimento novo, como antes', async () => {
    withOpenCharge('2026-01-10', 'BOLETO');
    const ctx = await quoteService.getBillingContext();
    quoteService.getBillingContext.mockResolvedValue({
      ...ctx,
      awaitingActivation: true,
    });
    const today = new Date().toISOString().split('T')[0];

    await service.pay(
      ADMIN,
      { billingType: 'PIX', termsAcceptance: ACCEPT },
      META,
    );

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dueDate: new Date(today),
          status: 'PENDING',
        }),
      }),
    );
  });

  it('só administrador regulariza', async () => {
    await expect(
      service.pay(
        { ...ADMIN, isAdmin: false },
        { billingType: 'PIX', termsAcceptance: ACCEPT },
        META,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('falha no gateway não registra aceite', async () => {
    withOpenCharge('2026-01-10');
    gateway.updateAsaasPayment.mockRejectedValue(new Error('Asaas fora'));

    await expect(
      service.pay(ADMIN, { billingType: 'PIX', termsAcceptance: ACCEPT }, META),
    ).rejects.toThrow(BadGatewayException);
    expect(acceptance.record).not.toHaveBeenCalled();
  });

  it('anual parcelado se regulariza no cartão: parcela em Pix deixaria as outras sem cartão', async () => {
    withOpenCharge('2026-01-10', 'CREDIT_CARD');
    quoteService.getBillingContext.mockResolvedValue({
      hasOpenCharge: true,
      hasOverdue: true,
      firstChargePending: false,
      current: {
        id: 'sub-1',
        customerId: 'cust-1',
        cycle: 'YEARLY',
        billingType: 'CREDIT_CARD',
        billingMode: 'ASAAS_INSTALLMENT',
        installmentCount: 12,
        value: 1617,
        plan: { name: 'Atrupe Start' },
      },
    });

    const view: any = await service.view('company-1');
    expect(view.allowedBillingTypes).toEqual(['CREDIT_CARD']);
    expect(view.subscription).toMatchObject({ installmentCount: 12 });

    await expect(
      service.pay(ADMIN, { billingType: 'PIX', termsAcceptance: ACCEPT }, META),
    ).rejects.toMatchObject({ response: { code: 'BILLING_TYPE_NOT_ALLOWED' } });
    expect(gateway.updateAsaasPayment).not.toHaveBeenCalled();
  });

  it('termos desatualizados são recusados', async () => {
    withOpenCharge('2026-01-10');
    await expect(
      service.pay(
        ADMIN,
        { billingType: 'PIX', termsAcceptance: { ...ACCEPT, version: 1 } },
        META,
      ),
    ).rejects.toMatchObject({ response: { code: 'TERMS_OUTDATED' } });
  });
});
