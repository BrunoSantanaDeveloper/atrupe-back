import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { PlanControlService } from '../../plan/plan-control.service';
import { SubscriptionQuoteService } from '../pricing/subscription-quote.service';
import { SubscriptionBlockService } from '../subscription-block.service';
import { CompanySessionService } from './company-session.service';

// Meio-dia local de 25/08: as datas de vencimento são meia-noite UTC do dia.
const HOJE = new Date(2026, 7, 25, 12, 0, 0);
const dia = (d: string) => new Date(`${d}T00:00:00.000Z`);

const payment = (status: string, dueDate: string) => ({
  asaasPaymentId: `pay_${dueDate}`,
  status,
  dueDate: dia(dueDate),
  value: 147,
  billingType: 'BOLETO',
  invoiceUrl: `https://asaas/i/${dueDate}`,
});

describe('CompanySessionService', () => {
  let service: CompanySessionService;
  const prisma = { company: { findUnique: jest.fn() } };
  const planControl = { getCompanyPlanInfo: jest.fn() };
  const quoteService = { getBillingContext: jest.fn() };
  const subscriptionBlock = { syncCompanyCharges: jest.fn() };

  const context = (payments: any[], extra: Record<string, any> = {}) => ({
    current: { payments },
    hasOpenCharge: false,
    hasOverdue: false,
    firstChargePending: false,
    awaitingActivation: false,
    confirmedPayment: null,
    intent: 'EVOLUTION',
    ...extra,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    planControl.getCompanyPlanInfo.mockResolvedValue({
      planType: 'START',
      trialEndsAt: null,
      features: { nfe: true, crm: false },
      limits: { max_users: 3 },
    });
    prisma.company.findUnique.mockResolvedValue({
      blockLevel: 'NONE',
      ownerUserId: 'user-1',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanySessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlanControlService, useValue: planControl },
        { provide: SubscriptionQuoteService, useValue: quoteService },
        { provide: SubscriptionBlockService, useValue: subscriptionBlock },
      ],
    }).compile();
    service = module.get(CompanySessionService);
  });

  it('plano pago ativo, só as features ligadas, e o titular', async () => {
    quoteService.getBillingContext.mockResolvedValue(
      context([payment('CONFIRMED', '2026-08-15')]),
    );

    const s = await service.build('company-1', 'user-1', HOJE);

    expect(s.plan).toEqual({
      name: 'START',
      active: true,
      trialEndsAt: null,
      features: ['nfe'],
      limits: { max_users: 3 },
    });
    expect(s.isOwner).toBe(true);
    expect(s.billing).toEqual({
      situation: 'EM_DIA',
      daysOverdue: 0,
      paymentPending: false,
      activationPending: false,
      chargeInFocus: null,
    });
  });

  it('quem não é o titular não recebe isOwner', async () => {
    quoteService.getBillingContext.mockResolvedValue(context([]));
    const s = await service.build('company-1', 'user-2', HOJE);
    expect(s.isOwner).toBe(false);
  });

  it('contratação com a primeira cobrança pendente: pagamento pendente, sem atraso', async () => {
    quoteService.getBillingContext.mockResolvedValue(
      context([payment('PENDING', '2026-08-27')], { firstChargePending: true }),
    );

    const s = await service.build('company-1', 'user-1', HOJE);

    expect(s.billing.paymentPending).toBe(true);
    // Contratada antes de 20/10: o acesso já está liberado.
    expect(s.billing.activationPending).toBe(false);
    expect(s.billing.situation).toBe('EM_DIA');
    expect(s.billing.chargeInFocus?.asaasPaymentId).toBe('pay_2026-08-27');
  });

  it('contratação esperando o pagamento: pendente, em foco e com o plano a liberar', async () => {
    quoteService.getBillingContext.mockResolvedValue(
      context([payment('PENDING', '2026-08-27')], {
        awaitingActivation: true,
        hasOpenCharge: true,
        intent: 'REGULARIZATION',
      }),
    );

    const s = await service.build('company-1', 'user-1', HOJE);

    expect(s.billing).toEqual({
      situation: 'EM_DIA',
      daysOverdue: 0,
      paymentPending: true,
      activationPending: true,
      chargeInFocus: expect.objectContaining({
        asaasPaymentId: 'pay_2026-08-27',
      }),
    });
  });

  it('contratação esperando o pagamento, com a cobrança vencida: segue a liberar', async () => {
    quoteService.getBillingContext.mockResolvedValue(
      context([payment('OVERDUE', '2026-08-23')], {
        awaitingActivation: true,
        hasOpenCharge: true,
        hasOverdue: true,
        intent: 'REGULARIZATION',
      }),
    );

    const s = await service.build('company-1', 'user-1', HOJE);

    expect(s.billing.activationPending).toBe(true);
    expect(s.billing.daysOverdue).toBe(2);
    expect(s.billing.chargeInFocus?.asaasPaymentId).toBe('pay_2026-08-23');
  });

  it('renovação futura não é pendência nem entra em foco', async () => {
    quoteService.getBillingContext.mockResolvedValue(
      context([
        payment('PENDING', '2026-09-15'),
        payment('CONFIRMED', '2026-08-15'),
      ]),
    );
    const s = await service.build('company-1', 'user-1', HOJE);
    expect(s.billing.chargeInFocus).toBeNull();
  });

  it('conta o atraso em dias de calendário, pela vencida mais antiga', async () => {
    quoteService.getBillingContext.mockResolvedValue(
      context([
        payment('OVERDUE', '2026-08-23'),
        payment('OVERDUE', '2026-08-20'),
      ]),
    );

    const s = await service.build('company-1', 'user-1', HOJE);

    // 20/08 → 25/08: 5 dias, nem um a mais (o fuso não pode somar um dia).
    expect(s.billing.daysOverdue).toBe(5);
    expect(s.billing.situation).toBe('ATRASADA');
    expect(s.billing.chargeInFocus?.asaasPaymentId).toBe('pay_2026-08-20');
  });

  it('cobrança pendente com vencimento passado também é atraso', async () => {
    quoteService.getBillingContext.mockResolvedValue(
      context([payment('PENDING', '2026-08-24')]),
    );
    const s = await service.build('company-1', 'user-1', HOJE);
    expect(s.billing.daysOverdue).toBe(1);
  });

  it('o nível de bloqueio manda na situação', async () => {
    quoteService.getBillingContext.mockResolvedValue(
      context([payment('OVERDUE', '2026-08-20')]),
    );

    prisma.company.findUnique.mockResolvedValue({
      blockLevel: 'PARTIAL',
      ownerUserId: null,
    });
    expect(
      (await service.build('company-1', undefined, HOJE)).billing.situation,
    ).toBe('BLOQUEADA');

    quoteService.getBillingContext.mockResolvedValue(
      context([payment('OVERDUE', '2026-08-10')]),
    );
    prisma.company.findUnique.mockResolvedValue({
      blockLevel: 'FULL',
      ownerUserId: null,
    });
    expect(
      (await service.build('company-1', undefined, HOJE)).billing.situation,
    ).toBe('INATIVA');
  });

  it('plano indisponível não derruba a sessão: vira teste, sem features', async () => {
    planControl.getCompanyPlanInfo.mockRejectedValue(new Error('falhou'));
    quoteService.getBillingContext.mockResolvedValue(context([]));

    const s = await service.build('company-1', 'user-1', HOJE);

    expect(s.plan).toMatchObject({
      name: 'TRIAL',
      active: false,
      features: [],
    });
  });

  describe('sessão do cliente conferida com o Asaas', () => {
    // Contratou e a primeira cobrança está em aberto aqui.
    const pendente = context([payment('PENDING', '2026-08-27')], {
      firstChargePending: true,
    });
    // O que o banco diz depois de alinhado: a primeira cobrança foi paga.
    const paga = context([payment('RECEIVED', '2026-08-27')]);

    it('sem cobrança em foco, não consulta o Asaas', async () => {
      quoteService.getBillingContext.mockResolvedValue(
        context([payment('CONFIRMED', '2026-08-15')]),
      );

      const s = await service.buildWithGatewayCheck(
        'company-1',
        'user-1',
        HOJE,
      );

      expect(s.billing.chargeInFocus).toBeNull();
      expect(subscriptionBlock.syncCompanyCharges).not.toHaveBeenCalled();
    });

    it('primeira cobrança paga no Asaas: alinha e responde já sem a pendência', async () => {
      quoteService.getBillingContext
        .mockResolvedValueOnce(pendente)
        .mockResolvedValueOnce(paga);
      subscriptionBlock.syncCompanyCharges.mockResolvedValue({
        created: 0,
        updated: 1,
        canceled: 0,
        activated: 0,
      });

      const s = await service.buildWithGatewayCheck(
        'company-1',
        'user-1',
        HOJE,
      );

      expect(subscriptionBlock.syncCompanyCharges).toHaveBeenCalledWith(
        'company-1',
      );
      expect(s.billing.paymentPending).toBe(false);
      expect(s.billing.chargeInFocus).toBeNull();
    });

    it('contratação liberada no alinhamento: remonta a sessão com o plano', async () => {
      const aLiberar = context([payment('PENDING', '2026-08-27')], {
        awaitingActivation: true,
        hasOpenCharge: true,
      });
      quoteService.getBillingContext
        .mockResolvedValueOnce(aLiberar)
        .mockResolvedValueOnce(paga);
      // A cobrança já estava paga aqui; faltava só liberar.
      subscriptionBlock.syncCompanyCharges.mockResolvedValue({
        created: 0,
        updated: 0,
        canceled: 0,
        activated: 1,
      });

      const s = await service.buildWithGatewayCheck(
        'company-1',
        'user-1',
        HOJE,
      );

      expect(quoteService.getBillingContext).toHaveBeenCalledTimes(2);
      expect(s.billing.activationPending).toBe(false);
      expect(s.billing.paymentPending).toBe(false);
    });

    it('nada mudou no Asaas: não remonta a sessão', async () => {
      quoteService.getBillingContext.mockResolvedValue(pendente);
      subscriptionBlock.syncCompanyCharges.mockResolvedValue({
        created: 0,
        updated: 0,
        canceled: 0,
        activated: 0,
      });

      const s = await service.buildWithGatewayCheck(
        'company-1',
        'user-1',
        HOJE,
      );

      expect(s.billing.paymentPending).toBe(true);
      expect(quoteService.getBillingContext).toHaveBeenCalledTimes(1);
    });

    it('confere cada empresa no máximo uma vez por minuto', async () => {
      quoteService.getBillingContext.mockResolvedValue(pendente);
      subscriptionBlock.syncCompanyCharges.mockResolvedValue({
        created: 0,
        updated: 0,
        canceled: 0,
        activated: 0,
      });

      await service.buildWithGatewayCheck('company-1', 'user-1', HOJE);
      await service.buildWithGatewayCheck('company-1', 'user-2', HOJE);
      expect(subscriptionBlock.syncCompanyCharges).toHaveBeenCalledTimes(1);

      // Outra empresa não espera a primeira.
      await service.buildWithGatewayCheck('company-2', 'user-3', HOJE);
      expect(subscriptionBlock.syncCompanyCharges).toHaveBeenCalledTimes(2);

      // Passado o minuto, confere de novo.
      (service as any).lastGatewayCheck.set('company-1', Date.now() - 61_000);
      await service.buildWithGatewayCheck('company-1', 'user-1', HOJE);
      expect(subscriptionBlock.syncCompanyCharges).toHaveBeenCalledTimes(3);
    });

    it('Asaas fora do ar: responde com o banco, sem erro', async () => {
      quoteService.getBillingContext.mockResolvedValue(pendente);
      subscriptionBlock.syncCompanyCharges.mockRejectedValue(
        new Error('timeout'),
      );

      const s = await service.buildWithGatewayCheck(
        'company-1',
        'user-1',
        HOJE,
      );

      expect(s.billing.paymentPending).toBe(true);
    });

    it('Asaas lento: não segura a resposta além do tempo-limite', async () => {
      (service as any).gatewayCheckTimeoutMs = 20;
      quoteService.getBillingContext.mockResolvedValue(pendente);
      let finishSync: (value: unknown) => void = () => undefined;
      const slowSync = new Promise((resolve) => {
        finishSync = resolve;
      });
      subscriptionBlock.syncCompanyCharges.mockReturnValue(slowSync);

      const s = await service.buildWithGatewayCheck(
        'company-1',
        'user-1',
        HOJE,
      );

      // Saiu o que o banco dizia, sem esperar o Asaas.
      expect(s.billing.paymentPending).toBe(true);
      expect(quoteService.getBillingContext).toHaveBeenCalledTimes(1);

      // O alinhamento termina sozinho depois, sem erro solto.
      finishSync({ created: 0, updated: 1, canceled: 0, activated: 0 });
      await slowSync;
    });
  });
});
