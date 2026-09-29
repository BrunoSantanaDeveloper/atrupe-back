import { CouponExpiryService, couponEndsAt } from './coupon-expiry.service';

const NOTA100 = {
  id: 'coupon-nf',
  code: 'NOTA100',
  durationType: 'MONTHS',
  durationMonths: 3,
};

const oldSubscription = (overrides: Record<string, any> = {}) => ({
  id: 'sub-1',
  companyId: 'company-1',
  status: 'ACTIVE',
  asaasSubscriptionId: 'sub_asaas_1',
  recurringValueCents: null,
  value: 147,
  additionalUsers: 0,
  createdAt: new Date('2026-01-20T12:00:00Z'),
  coupon: NOTA100,
  plan: { basePrice: 14700, additionalUserPrice: 1500 },
  subscriptionFeatures: [{ price: 7000 }],
  ...overrides,
});

function setup() {
  const tx = {
    subscription: { update: jest.fn() },
    payment: { updateMany: jest.fn() },
    subscriptionHistory: { create: jest.fn() },
  };
  const prisma = {
    subscription: { findUnique: jest.fn(), findMany: jest.fn() },
    couponUsage: { findFirst: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const gateway = {
    updateAsaasSubscription: jest.fn(),
    getAsaasSubscriptionPayments: jest.fn().mockResolvedValue([]),
    updateAsaasPayment: jest.fn(),
  };
  const service = new CouponExpiryService(prisma as any, gateway as any);
  return { service, prisma, gateway, tx };
}

describe('couponEndsAt', () => {
  it('por meses: o uso mais a duração', () => {
    expect(
      couponEndsAt(NOTA100, new Date('2026-06-09T12:00:00Z')).toISOString(),
    ).toBe('2026-09-09T12:00:00.000Z');
  });

  it('recorrente não acaba', () => {
    expect(
      couponEndsAt(
        { durationType: 'RECURRING', durationMonths: null },
        new Date(),
      ),
    ).toBeNull();
  });
});

describe('CouponExpiryService', () => {
  it('antes do fim do desconto, não mexe em nada', async () => {
    const { service, prisma, gateway } = setup();
    prisma.subscription.findUnique.mockResolvedValue(oldSubscription());
    prisma.couponUsage.findFirst.mockResolvedValue({
      createdAt: new Date('2026-06-09T12:00:00Z'),
    });

    await expect(
      service.expireIfDue('sub-1', new Date('2026-08-30T12:00:00Z')),
    ).resolves.toBe(false);
    expect(gateway.updateAsaasSubscription).not.toHaveBeenCalled();
  });

  it('vale pela data do cupom, não pelos pagamentos de antes dele', async () => {
    // Assinatura de janeiro, cupom de junho: contar os pagamentos desde
    // janeiro expirava o desconto já no pagamento seguinte ao cupom.
    const { service, prisma, gateway, tx } = setup();
    prisma.subscription.findUnique.mockResolvedValue(oldSubscription());
    prisma.couponUsage.findFirst.mockResolvedValue({
      createdAt: new Date('2026-06-09T12:00:00Z'),
    });
    gateway.getAsaasSubscriptionPayments.mockResolvedValue([
      // Dentro do prazo do desconto: segue com ele.
      { id: 'pay_ago', status: 'RECEIVED', dueDate: '2026-08-22', value: 147 },
      // A já gerada depois do fim do desconto: sobe junto.
      { id: 'pay_out', status: 'PENDING', dueDate: '2026-10-22', value: 147 },
    ]);

    await expect(
      service.expireIfDue('sub-1', new Date('2026-09-29T12:00:00Z')),
    ).resolves.toBe(true);

    expect(gateway.updateAsaasSubscription).toHaveBeenCalledWith(
      'sub_asaas_1',
      {
        value: 217,
        updatePendingPayments: false,
      },
    );
    expect(gateway.updateAsaasPayment).toHaveBeenCalledTimes(1);
    expect(gateway.updateAsaasPayment).toHaveBeenCalledWith('pay_out', {
      value: 217,
    });
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { value: 217, couponId: null },
    });
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { asaasPaymentId: 'pay_out' },
      data: { value: 217 },
    });
  });

  it('contratação nova (valor cheio desde o início) não passa por aqui', async () => {
    const { service, prisma, gateway } = setup();
    prisma.subscription.findUnique.mockResolvedValue(
      oldSubscription({ recurringValueCents: 21700 }),
    );

    await expect(service.expireIfDue('sub-1')).resolves.toBe(false);
    expect(gateway.updateAsaasSubscription).not.toHaveBeenCalled();
  });

  it('sem registro de uso, conta da criação da assinatura', async () => {
    const { service, prisma, gateway } = setup();
    prisma.subscription.findUnique.mockResolvedValue(oldSubscription());
    prisma.couponUsage.findFirst.mockResolvedValue(null);

    // Criada em 20/01 com 3 meses: acabou em 20/04.
    await expect(
      service.expireIfDue('sub-1', new Date('2026-04-21T12:00:00Z')),
    ).resolves.toBe(true);
    expect(gateway.updateAsaasSubscription).toHaveBeenCalled();
  });
});
