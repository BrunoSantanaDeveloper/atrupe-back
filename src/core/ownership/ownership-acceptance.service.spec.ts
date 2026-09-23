import { GoneException } from '@nestjs/common';
import { OwnershipAcceptanceService } from './ownership-acceptance.service';
import { hashInviteToken } from './ownership.domain';

// argon2 é caro de propósito; aqui só importa que a senha não vá em claro.
jest.mock('argon2', () => ({
  hash: jest.fn(async (password: string) => `argon2:${password.length}`),
}));

describe('OwnershipAcceptanceService', () => {
  const NOW = new Date('2026-09-22T12:00:00.000Z');
  const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
  const TOKEN = 'token-do-convite-com-mais-de-vinte-caracteres';

  const transfer = {
    id: 'transfer-1',
    companyId: 'company-1',
    companyName: 'Marcenaria Horizonte',
    fromUserId: 'titular',
    fromUserName: 'Ana Titular',
    targetEmail: 'nova@empresa.com.br',
    tokenHash: hashInviteToken(TOKEN),
    status: 'PENDING',
    createdAt: days(2),
  };

  const company = {
    id: 'company-1',
    name: 'Marcenaria Horizonte',
    legalName: 'Marcenaria Horizonte Ltda',
    cnpj: '11.222.333/0001-81',
    createdAt: new Date('2025-03-10T12:00:00.000Z'),
    ownerUserId: 'titular',
    principalCompanyId: null,
    _count: { subsidiaries: 0 },
  };

  const current = {
    id: 'sub-old',
    companyId: 'company-1',
    status: 'ACTIVE',
    billingMode: 'ASAAS_SUBSCRIPTION',
    asaasSubscriptionId: 'sub_old',
    asaasInstallmentId: null,
    customerId: 'cust-old',
    planId: 'plan-start',
    plan: { name: 'Start' },
    value: 147,
    cycle: 'MONTHLY',
    billingType: 'CREDIT_CARD',
    // O Asaas já gerou a de outubro: o próximo vencimento andou para novembro.
    nextDueDate: new Date('2026-11-05T00:00:00.000Z'),
    contractedAt: new Date('2026-06-05T00:00:00.000Z'),
    recurringValueCents: 14700,
    pricingSnapshot: { engine: 'pricing.engine/v1' },
    additionalUsers: 1,
    installmentCount: null,
    payments: [],
  };

  const dto = {
    token: TOKEN,
    name: 'Bruno Novo',
    password: 'Senha@Forte1',
    company: {
      cnpj: '45723174000110',
      legalName: 'Nova Empresa Ltda',
      tradeName: 'Nova Empresa',
    },
    representative: { cpf: '52998224725', name: 'Bruno Novo', isSelf: true },
    termsAcceptance: { contractId: 'contract-3', version: 3, accepted: true },
  };

  let prisma: any;
  let gateway: any;
  let quoteService: any;
  let registry: any;
  let acceptance: any;
  let ownership: any;
  let sessionAccess: any;
  let mailer: any;
  let service: OwnershipAcceptanceService;

  beforeEach(() => {
    prisma = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([]),
      ownershipTransfer: {
        findUnique: jest.fn().mockResolvedValue(transfer),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          name: 'Ana Titular',
          email: 'ana@horizonte.com.br',
        }),
        create: jest.fn(async ({ data }) => ({ id: 'user-novo', ...data })),
        update: jest.fn(),
      },
      employee: {
        findMany: jest.fn().mockResolvedValue([{ id: 'emp-ana' }]),
        updateMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }) => ({ id: 'emp-novo', ...data })),
      },
      employeeHistory: { create: jest.fn() },
      company: { update: jest.fn() },
      invoicyConfig: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'emissor-1', name: 'Matriz' }]),
        update: jest.fn(),
      },
      invoicyEnvironmentConfig: { updateMany: jest.fn() },
      companyEnvironmentCredential: { deleteMany: jest.fn() },
      digitalCertificate: { deleteMany: jest.fn() },
      fiscalOnboardingRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      address: {
        findFirst: jest.fn().mockResolvedValue({ id: 'addr-1' }),
        update: jest.fn(),
        create: jest.fn(),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }) => ({ id: 'cust-new', ...data })),
        update: jest.fn(),
      },
      subscription: { create: jest.fn(), update: jest.fn() },
      subscriptionFeature: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ featureId: 'nota_fiscal', price: 70 }]),
        createMany: jest.fn(),
      },
      payment: {
        updateMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      subscriptionHistory: { create: jest.fn() },
      ownershipPeriod: {
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      companySector: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sector-adm' }),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: 'role-admin' }),
        create: jest.fn(),
      },
      sellerProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: 'seller-admin' }),
        create: jest.fn(),
      },
      payrollTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      payrollSetup: { create: jest.fn() },
      companyHistory: { create: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));

    gateway = {
      getChargesOf: jest.fn().mockResolvedValue([
        { id: 'pay_paid', status: 'RECEIVED', dueDate: '2026-09-05' },
        { id: 'pay_next', status: 'PENDING', dueDate: '2026-10-05' },
      ]),
      createAsaasCustomer: jest.fn().mockResolvedValue({ id: 'cus_new' }),
      updateAsaasCustomer: jest.fn(),
      createSubscription: jest.fn().mockResolvedValue({ id: 'sub_new' }),
      getAsaasSubscriptionPayments: jest.fn().mockResolvedValue([
        {
          id: 'pay_new',
          status: 'PENDING',
          dueDate: '2026-10-05',
          value: 147,
          billingType: 'CREDIT_CARD',
          invoiceUrl: 'https://asaas/i/pay_new',
        },
      ]),
      deleteAsaasPayment: jest.fn().mockResolvedValue(undefined),
      cancelAsaasSubscription: jest.fn().mockResolvedValue(undefined),
      mapAsaasPaymentStatus: jest.fn((s) => s),
    };
    quoteService = {
      getBillingContext: jest.fn().mockResolvedValue({ current }),
    };
    registry = {
      lookup: jest.fn().mockResolvedValue({
        cnpj: '45723174000110',
        legalName: 'Nova Empresa Ltda',
        tradeName: 'Nova Empresa',
        registrationStatus: 'ATIVA',
        isActive: true,
        address: {
          street: 'Rua Nova',
          number: '10',
          complement: '',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
          zipcode: '80000000',
        },
        partners: [],
        fetchedAt: NOW.toISOString(),
      }),
      publicView: jest.fn(),
    };
    acceptance = {
      currentTerms: jest.fn().mockResolvedValue({
        id: 'contract-3',
        version: 3,
        html: '<p>Termos</p>',
        sha256: 'abc',
      }),
      record: jest.fn().mockResolvedValue({ id: 'acc-1' }),
    };
    ownership = {
      loadCompany: jest.fn().mockResolvedValue(company),
      blockedReason: jest.fn().mockResolvedValue(null),
      view: jest.fn().mockResolvedValue({
        current: {
          holderName: 'Marcenaria Horizonte Ltda',
          document: '11222333000181',
          email: 'ana@horizonte.com.br',
          startedAt: new Date('2025-03-10T12:00:00.000Z'),
          endedAt: null,
        },
      }),
    };
    sessionAccess = { forgetUser: jest.fn() };
    mailer = { sendMail: jest.fn().mockResolvedValue(undefined) };

    service = new OwnershipAcceptanceService(
      prisma,
      gateway,
      quoteService,
      registry,
      acceptance,
      ownership,
      sessionAccess,
      mailer,
    );
  });

  describe('open', () => {
    it('link que não corresponde a convite nenhum diz isso', async () => {
      prisma.ownershipTransfer.findUnique.mockResolvedValue(null);

      await expect(service.open('qualquer-coisa', NOW)).resolves.toMatchObject({
        state: 'INVALID',
      });
    });

    it('convite cancelado diz que foi cancelado, sem dados do ambiente', async () => {
      prisma.ownershipTransfer.findUnique.mockResolvedValue({
        ...transfer,
        status: 'CANCELED',
      });

      const view: any = await service.open(TOKEN, NOW);

      expect(view).toEqual({
        state: 'CANCELED',
        message: 'Esta transferência foi cancelada por quem a enviou.',
      });
    });

    it('pendente: de que ambiente é, os dias restantes e se o e-mail já tem conta', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'existente' });

      const view: any = await service.open(TOKEN, NOW);

      expect(view).toMatchObject({
        state: 'PENDING',
        companyName: 'Marcenaria Horizonte',
        targetEmail: 'nova@empresa.com.br',
        daysLeft: 12,
        emailHasAccount: true,
        blocked: null,
        terms: { contractId: 'contract-3', version: 3 },
      });
    });
  });

  describe('accept', () => {
    it('convite vencido não aceita nada', async () => {
      prisma.ownershipTransfer.findUnique.mockResolvedValue({
        ...transfer,
        createdAt: days(15),
      });

      await expect(service.accept(dto as any, {}, NOW)).rejects.toBeInstanceOf(
        GoneException,
      );
      expect(prisma.ownershipTransfer.updateMany).not.toHaveBeenCalled();
    });

    it('e-mail que já tem conta é recusado, sem oferecer login', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'existente' });

      await expect(service.accept(dto as any, {}, NOW)).rejects.toMatchObject({
        response: { code: 'EMAIL_HAS_ACCOUNT' },
      });
      expect(gateway.createAsaasCustomer).not.toHaveBeenCalled();
    });

    it('senha fora das cinco regras é recusada no servidor', async () => {
      await expect(
        service.accept({ ...dto, password: 'fraca' } as any, {}, NOW),
      ).rejects.toMatchObject({ response: { code: 'WEAK_PASSWORD' } });
    });

    it('sem aceitar os Termos não efetiva', async () => {
      await expect(
        service.accept(
          {
            ...dto,
            termsAcceptance: { ...dto.termsAcceptance, accepted: false },
          } as any,
          {},
          NOW,
        ),
      ).rejects.toMatchObject({ response: { code: 'TERMS_REQUIRED' } });
    });

    it('CNPJ que já tem ambiente na Atrupe é recusado', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'outra-empresa' }]);

      await expect(service.accept(dto as any, {}, NOW)).rejects.toMatchObject({
        response: { code: 'CNPJ_IN_USE' },
      });
      expect(prisma.ownershipTransfer.updateMany).not.toHaveBeenCalled();
    });

    it('cobrança em aberto bloqueia o aceite', async () => {
      ownership.blockedReason.mockResolvedValue({
        code: 'OPEN_CHARGE',
        message: 'Há uma cobrança em aberto.',
      });

      await expect(service.accept(dto as any, {}, NOW)).rejects.toMatchObject({
        response: { code: 'OPEN_CHARGE' },
      });
    });

    it('efetiva: a cobrança passa ao cliente novo, sem nunca correrem duas', async () => {
      const result = await service.accept(
        dto as any,
        { ip: '200.1.2.3', userAgent: 'jest' },
        NOW,
      );

      expect(result).toEqual({
        accepted: true,
        email: 'nova@empresa.com.br',
        companyName: 'Nova Empresa',
      });

      // Cliente novo no Asaas, com a empresa de quem aceitou.
      expect(gateway.createAsaasCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Nova Empresa Ltda',
          cpfCnpj: '45723174000110',
          email: 'nova@empresa.com.br',
        }),
      );
      // A assinatura nova vence quando venceria a cobrança já gerada.
      const payload = gateway.createSubscription.mock.calls[0][0];
      expect(payload).toMatchObject({
        customer: 'cus_new',
        billingType: 'CREDIT_CARD',
        value: 147,
        cycle: 'MONTHLY',
      });
      expect(payload.nextDueDate).toEqual(new Date('2026-10-05T00:00:00.000Z'));
      // A nova antes de a anterior deixar de cobrar; as futuras apagadas
      // antes de encerrá-la.
      expect(gateway.deleteAsaasPayment).toHaveBeenCalledWith('pay_next');
      expect(gateway.deleteAsaasPayment).not.toHaveBeenCalledWith('pay_paid');
      expect(gateway.cancelAsaasSubscription).toHaveBeenCalledWith('sub_old');
      const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
      expect(order(gateway.createSubscription)).toBeLessThan(
        order(gateway.deleteAsaasPayment),
      );
      expect(order(gateway.deleteAsaasPayment)).toBeLessThan(
        order(gateway.cancelAsaasSubscription),
      );
    });

    it('efetiva: conta nova como titular, quem enviou sai e o ambiente fica', async () => {
      await service.accept(dto as any, {}, NOW);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'nova@empresa.com.br',
          name: 'Bruno Novo',
          isActive: true,
        }),
      });
      const created = prisma.user.create.mock.calls[0][0].data;
      expect(created.password).not.toBe('Senha@Forte1');

      expect(prisma.employee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-novo',
          roleId: 'role-admin',
          companyId: 'company-1',
          cpf: '52998224725',
        }),
      });
      // Quem enviou continua colaborador, sem usuário, e a conta dele, sem
      // outro ambiente, é desativada.
      expect(prisma.employee.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', userId: 'titular' },
        data: { userId: null },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'titular' },
        data: { isActive: false },
      });
      expect(sessionAccess.forgetUser).toHaveBeenCalledWith('titular');

      expect(prisma.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: expect.objectContaining({
          ownerUserId: 'user-novo',
          cnpj: '45723174000110',
          legalName: 'Nova Empresa Ltda',
          name: 'Nova Empresa',
          stateRegistration: null,
          fiscalResetAt: NOW,
        }),
      });

      expect(prisma.ownershipTransfer.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'transfer-1', status: 'ACCEPTING' },
        data: {
          status: 'ACCEPTED',
          acceptedAt: NOW,
          previousCnpj: '11222333000181',
          newCnpj: '45723174000110',
        },
      });
    });

    it('efetiva: a assinatura atravessa com plano, complementos e vencimento', async () => {
      await service.accept(dto as any, {}, NOW);

      const data = prisma.subscription.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        companyId: 'company-1',
        customerId: 'cust-new',
        planId: 'plan-start',
        additionalUsers: 1,
        asaasSubscriptionId: 'sub_new',
        billingMode: 'ASAAS_SUBSCRIPTION',
        value: 147,
        status: 'ACTIVE',
        cycle: 'MONTHLY',
        contractedAt: current.contractedAt,
        previousSubscriptionId: 'sub-old',
        nextDueDate: new Date('2026-10-05T00:00:00.000Z'),
      });
      expect(prisma.subscriptionFeature.createMany).toHaveBeenCalledWith({
        data: [
          {
            subscriptionId: data.id,
            featureId: 'nota_fiscal',
            price: 70,
            isActive: true,
          },
        ],
      });
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-old' },
        data: { status: 'CANCELED', endedReason: 'TRANSFERRED' },
      });
      // A primeira cobrança da nova, no cliente novo.
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subscriptionId: data.id,
          asaasPaymentId: 'pay_new',
          asaasCustomerId: 'cus_new',
        }),
      });
    });

    it('efetiva: períodos de titularidade, aceite dos Termos e fiscal do CNPJ anterior', async () => {
      await service.accept(dto as any, { ip: '200.1.2.3' }, NOW);

      expect(prisma.ownershipPeriod.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', endedAt: null },
        data: expect.objectContaining({
          endedAt: NOW,
          transferId: 'transfer-1',
          holderName: 'Marcenaria Horizonte Ltda',
        }),
      });
      expect(prisma.ownershipPeriod.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-novo',
          holderName: 'Nova Empresa Ltda',
          document: '45723174000110',
          startedAt: NOW,
        }),
      });

      expect(acceptance.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          context: 'OWNERSHIP_TRANSFER',
          companyId: 'company-1',
          acceptedBy: expect.objectContaining({ userId: 'user-novo' }),
          contractor: expect.objectContaining({ document: '45723174000110' }),
          ipAddress: '200.1.2.3',
        }),
      );

      // CNPJ trocado: emissores de antes desativados e renomeados, chave e
      // certificado apagados.
      expect(prisma.invoicyConfig.update).toHaveBeenCalledWith({
        where: { id: 'emissor-1' },
        data: {
          isActive: false,
          isDefault: false,
          name: 'Matriz (CNPJ anterior 11.222.333/0001-81)',
        },
      });
      expect(prisma.companyEnvironmentCredential.deleteMany).toHaveBeenCalled();
      expect(prisma.digitalCertificate.deleteMany).toHaveBeenCalled();

      expect(mailer.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ana@horizonte.com.br',
          template: 'ownership-transfer-completed',
        }),
      );
    });

    it('mesmo CNPJ: a identidade fiscal fica como está', async () => {
      await service.accept(
        {
          ...dto,
          company: { ...dto.company, cnpj: '11222333000181' },
        } as any,
        {},
        NOW,
      );

      const data = prisma.company.update.mock.calls[0][0].data;
      expect(data.fiscalResetAt).toBeUndefined();
      expect(data.name).toBeUndefined();
      expect(prisma.invoicyConfig.update).not.toHaveBeenCalled();
    });

    it('teste grátis, sem cobrança no Asaas: só a titularidade muda', async () => {
      quoteService.getBillingContext.mockResolvedValue({ current: null });

      await service.accept(dto as any, {}, NOW);

      expect(gateway.createAsaasCustomer).not.toHaveBeenCalled();
      expect(gateway.createSubscription).not.toHaveBeenCalled();
      expect(prisma.subscription.create).not.toHaveBeenCalled();
      expect(acceptance.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ subscriptionId: null }),
      );
    });

    it('falha no Asaas antes de encerrar a anterior: nada muda e o convite volta a valer', async () => {
      gateway.createSubscription.mockRejectedValue(
        new Error('Asaas fora do ar'),
      );

      await expect(service.accept(dto as any, {}, NOW)).rejects.toMatchObject({
        response: { code: 'TRANSFER_FAILED' },
      });
      expect(gateway.deleteAsaasPayment).not.toHaveBeenCalled();
      expect(gateway.cancelAsaasSubscription).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.ownershipTransfer.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'transfer-1', status: 'ACCEPTING' },
        data: { status: 'PENDING' },
      });
    });

    it('gravação que falha duas vezes desfaz a assinatura nova no Asaas', async () => {
      prisma.user.create.mockRejectedValue(new Error('conexão perdida'));

      await expect(service.accept(dto as any, {}, NOW)).rejects.toMatchObject({
        response: { code: 'TRANSFER_FAILED' },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(gateway.cancelAsaasSubscription).toHaveBeenCalledWith('sub_new');
      expect(sessionAccess.forgetUser).not.toHaveBeenCalled();
    });

    it('dois aceites ao mesmo tempo: o segundo encontra a reserva do primeiro', async () => {
      prisma.ownershipTransfer.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.accept(dto as any, {}, NOW)).rejects.toMatchObject({
        response: { code: 'TRANSFER_IN_PROGRESS' },
      });
      expect(gateway.createAsaasCustomer).not.toHaveBeenCalled();
    });
  });
});
