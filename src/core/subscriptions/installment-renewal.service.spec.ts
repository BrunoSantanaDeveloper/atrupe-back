import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from './asaas-gateway.service';
import { InstallmentRenewalService } from './installment-renewal.service';

const AGORA = new Date('2026-09-15T09:00:00.000Z');
const FIM_DO_ANO_PAGO = new Date('2026-09-24T12:00:00.000Z');

const anualParcelado = (overrides: Record<string, any> = {}) => ({
  id: 'sub-1',
  status: 'ACTIVE',
  billingMode: 'ASAAS_INSTALLMENT',
  asaasSubscriptionId: 'inst_sub-1',
  asaasInstallmentId: 'ins_ano1',
  installmentCount: 12,
  nextDueDate: FIM_DO_ANO_PAGO,
  recurringValueCents: 161700,
  value: 1617,
  customer: { asaasCustomerId: 'cus_1' },
  plan: { name: 'Atrupe Start' },
  ...overrides,
});

const parcelasDaRenovacao = () =>
  Array.from({ length: 12 }, (_, i) => ({
    id: 'pay_ano2_' + (i + 1),
    value: 134.75,
    dueDate: '2026-09-24',
    status: 'PENDING',
    installment: 'ins_ano2',
    installmentNumber: i + 1,
    invoiceUrl: 'https://asaas/i/ano2',
  }));

describe('InstallmentRenewalService', () => {
  let service: InstallmentRenewalService;

  const tx = {
    payment: { findUnique: jest.fn(), create: jest.fn() },
    subscription: { update: jest.fn() },
    subscriptionHistory: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((cb: any) => cb(tx)),
    subscription: { findMany: jest.fn() },
  };
  const gateway = {
    getInstallmentPayments: jest.fn(),
    findPaymentsByExternalReference: jest.fn(),
    createInstallmentCharge: jest.fn(),
    mapAsaasPaymentStatus: jest.fn(() => 'PENDING'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb: any) => cb(tx));
    tx.payment.findUnique.mockResolvedValue(null);
    prisma.subscription.findMany.mockResolvedValue([anualParcelado()]);
    gateway.findPaymentsByExternalReference.mockResolvedValue([]);
    gateway.createInstallmentCharge.mockResolvedValue({
      id: 'pay_ano2_1',
      installment: 'ins_ano2',
    });
    gateway.getInstallmentPayments.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'ins_ano1'
          ? [
              {
                id: 'pay_ano1_1',
                value: 134.75,
                dueDate: '2025-09-24',
                status: 'RECEIVED',
              },
            ]
          : parcelasDaRenovacao(),
      ),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstallmentRenewalService,
        { provide: PrismaService, useValue: prisma },
        { provide: AsaasGatewayService, useValue: gateway },
      ],
    }).compile();
    service = module.get(InstallmentRenewalService);
  });

  it('busca só o anual parcelado ativo que vence nos próximos dias', async () => {
    await service.renewDue(AGORA);
    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          billingMode: 'ASAAS_INSTALLMENT',
          status: 'ACTIVE',
          nextDueDate: {
            lte: new Date(AGORA.getTime() + 10 * 86_400_000),
          },
        },
      }),
    );
  });

  it('cria o parcelamento do ano seguinte, com o valor da renovação, vencendo no fim do ano pago', async () => {
    const [result] = await service.renewDue(AGORA);

    expect(gateway.createInstallmentCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        billingType: 'CREDIT_CARD',
        installmentCount: 12,
        totalValue: 1617,
        dueDate: '2026-09-24',
        externalReference: 'sub-1:2026-09-24',
      }),
    );
    expect(tx.payment.create).toHaveBeenCalledTimes(12);
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({
      kind: 'RENEWAL',
      periodStart: FIM_DO_ANO_PAGO,
      asaasInstallmentId: 'ins_ano2',
      installmentNumber: 1,
    });
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: {
        asaasInstallmentId: 'ins_ano2',
        nextDueDate: new Date('2027-09-24T12:00:00.000Z'),
      },
    });
    expect(result).toEqual({
      subscriptionId: 'sub-1',
      action: 'renewed',
      asaasInstallmentId: 'ins_ano2',
    });
  });

  it('parcelamento já criado numa execução que caiu: só registra, não cobra de novo', async () => {
    gateway.findPaymentsByExternalReference.mockResolvedValue([
      { id: 'pay_ano2_1', installment: 'ins_ano2' },
    ]);

    const [result] = await service.renewDue(AGORA);

    expect(gateway.createInstallmentCharge).not.toHaveBeenCalled();
    expect(tx.payment.create).toHaveBeenCalledTimes(12);
    expect(result.action).toBe('renewed');
  });

  it('parcela do ano em curso em aberto: a renovação espera a regularização', async () => {
    gateway.getInstallmentPayments.mockResolvedValue([
      {
        id: 'pay_ano1_3',
        value: 134.75,
        dueDate: '2026-01-24',
        status: 'OVERDUE',
      },
    ]);

    const [result] = await service.renewDue(AGORA);

    expect(result).toMatchObject({ action: 'skipped', reason: 'OPEN_CHARGE' });
    expect(gateway.createInstallmentCharge).not.toHaveBeenCalled();
  });

  it('sem cliente no Asaas, não há onde cobrar', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      anualParcelado({ customer: { asaasCustomerId: 'manual_1' } }),
    ]);
    const [result] = await service.renewDue(AGORA);
    expect(result).toMatchObject({
      action: 'skipped',
      reason: 'NO_BILLING_ACCOUNT',
    });
  });

  it('a falha de uma assinatura não impede as outras', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      anualParcelado({ id: 'sub-falha' }),
      anualParcelado({ id: 'sub-ok' }),
    ]);
    gateway.createInstallmentCharge
      .mockRejectedValueOnce(new Error('Asaas fora'))
      .mockResolvedValueOnce({ id: 'pay_ano2_1', installment: 'ins_ano2' });

    const results = await service.renewDue(AGORA);

    expect(results.map((r) => [r.subscriptionId, r.action])).toEqual([
      ['sub-falha', 'failed'],
      ['sub-ok', 'renewed'],
    ]);
  });
});
