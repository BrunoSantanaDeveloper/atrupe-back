import { Logger } from '@nestjs/common';
import { computeQuote } from '../pricing/pricing.engine';
import {
  assertCycleAvailable,
  assertInstallments,
  contractBillingMode,
  openGatewayContract,
  recordContractCharges,
} from './contracting-steps';

const START = {
  name: 'Atrupe Start',
  basePriceCents: 14700,
  additionalUserPriceCents: 1500,
};

// Start anual: 147 × 11 = 1.617, em 12x no cartão.
const anualEm12x = computeQuote({
  plan: START,
  cycle: 'YEARLY',
  billingType: 'CREDIT_CARD',
  installmentCount: 12,
});

const PRIMEIRO_VENCIMENTO = new Date('2026-09-24T12:00:00.000Z');

const parcelas = (count: number, value: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `pay_${i + 1}`,
    value,
    dueDate: `2026-${String(9 + i).padStart(2, '0')}-24`,
    status: 'PENDING',
    installment: 'ins_1',
    installmentNumber: i + 1,
    invoiceUrl: `https://asaas/i/${i + 1}`,
  }));

describe('contracting-steps', () => {
  const logger = { error: jest.fn(), warn: jest.fn() } as unknown as Logger;
  const gateway = {
    createSubscription: jest.fn(),
    createInstallmentCharge: jest.fn(),
    getAsaasSubscriptionPayments: jest.fn(),
    getInstallmentPayments: jest.fn(),
    updateAsaasPayment: jest.fn(),
    cancelAsaasSubscription: jest.fn(),
    deleteInstallment: jest.fn(),
    deleteAsaasPayment: jest.fn(),
    getPixQrCode: jest.fn(),
    mapAsaasPaymentStatus: jest.fn(() => 'PENDING'),
  };

  beforeEach(() => jest.clearAllMocks());

  describe('contractBillingMode', () => {
    it.each([
      ['YEARLY', 'CREDIT_CARD', 12, 'ASAAS_INSTALLMENT'],
      ['YEARLY', 'CREDIT_CARD', 1, 'ASAAS_SUBSCRIPTION'],
      ['YEARLY', 'PIX', 12, 'ASAAS_SUBSCRIPTION'],
      ['MONTHLY', 'CREDIT_CARD', 3, 'ASAAS_SUBSCRIPTION'],
    ] as const)('%s + %s em %ix é %s', (cycle, billingType, count, mode) => {
      expect(contractBillingMode(cycle, billingType, count)).toBe(mode);
    });
  });

  describe('assertInstallments', () => {
    it('parcelas oferecidas pelo orçamento passam', () => {
      expect(() => assertInstallments(anualEm12x, 12)).not.toThrow();
    });

    it('parcelas no mensal são recusadas', () => {
      const mensal = computeQuote({ plan: START, cycle: 'MONTHLY' });
      expect(() => assertInstallments(mensal, 3)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'INSTALLMENTS_NOT_AVAILABLE',
          }),
        }),
      );
    });
  });

  describe('assertCycleAvailable', () => {
    const original = process.env.ANNUAL_CYCLE_ENABLED;
    afterEach(() => {
      process.env.ANNUAL_CYCLE_ENABLED = original;
    });

    it('o anual só passa com a chave ligada', () => {
      delete process.env.ANNUAL_CYCLE_ENABLED;
      expect(() => assertCycleAvailable('YEARLY')).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'CYCLE_NOT_AVAILABLE' }),
        }),
      );
      expect(() => assertCycleAvailable('MONTHLY')).not.toThrow();

      process.env.ANNUAL_CYCLE_ENABLED = 'true';
      expect(() => assertCycleAvailable('YEARLY')).not.toThrow();
    });
  });

  describe('openGatewayContract', () => {
    const base = {
      customer: 'cus_1',
      billingType: 'CREDIT_CARD',
      cycle: 'YEARLY' as const,
      quote: anualEm12x,
      chargesNow: true,
      firstDueDate: PRIMEIRO_VENCIMENTO,
      description: 'Assinatura Atrupe Start',
      externalReference: 'sub-local-1',
    };

    it('anual à vista vira assinatura anual no Asaas', async () => {
      gateway.createSubscription.mockResolvedValue({
        id: 'sub_1',
        nextDueDate: '2026-09-24',
      });
      gateway.getAsaasSubscriptionPayments.mockResolvedValue([
        { id: 'pay_1', value: 1617, dueDate: '2026-09-24', status: 'PENDING' },
      ]);

      const contract = await openGatewayContract(gateway as any, logger, {
        ...base,
        billingType: 'PIX',
        installmentCount: 1,
      });

      expect(gateway.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ cycle: 'YEARLY', value: 1617 }),
      );
      expect(contract).toMatchObject({
        billingMode: 'ASAAS_SUBSCRIPTION',
        asaasSubscriptionId: 'sub_1',
        asaasInstallmentId: null,
      });
    });

    it('anual em 12x no cartão vira cobrança parcelada, com o ano seguinte como renovação', async () => {
      gateway.createInstallmentCharge.mockResolvedValue({
        id: 'pay_1',
        installment: 'ins_1',
      });
      gateway.getInstallmentPayments.mockResolvedValue(parcelas(12, 134.75));

      const contract = await openGatewayContract(gateway as any, logger, {
        ...base,
        installmentCount: 12,
      });

      expect(gateway.createSubscription).not.toHaveBeenCalled();
      expect(gateway.createInstallmentCharge).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_1',
          billingType: 'CREDIT_CARD',
          installmentCount: 12,
          totalValue: 1617,
          dueDate: '2026-09-24',
          externalReference: 'sub-local-1',
        }),
      );
      expect(contract).toMatchObject({
        billingMode: 'ASAAS_INSTALLMENT',
        asaasSubscriptionId: null,
        asaasInstallmentId: 'ins_1',
      });
      expect(contract.charges).toHaveLength(12);
      expect(contract.nextDueDate.toISOString()).toBe(
        '2027-09-24T12:00:00.000Z',
      );
    });

    it('parcelas faltando: o parcelamento é desfeito', async () => {
      gateway.createInstallmentCharge.mockResolvedValue({
        id: 'pay_1',
        installment: 'ins_1',
      });
      gateway.getInstallmentPayments.mockResolvedValue(parcelas(11, 134.75));

      await expect(
        openGatewayContract(gateway as any, logger, {
          ...base,
          installmentCount: 12,
        }),
      ).rejects.toThrow('11 parcelas');
      expect(gateway.deleteInstallment).toHaveBeenCalledWith('ins_1');
    });

    it('crédito que paga o ano: nada é parcelado agora', async () => {
      const contract = await openGatewayContract(gateway as any, logger, {
        ...base,
        installmentCount: 12,
        chargesNow: false,
      });

      expect(gateway.createInstallmentCharge).not.toHaveBeenCalled();
      expect(contract).toMatchObject({
        billingMode: 'ASAAS_INSTALLMENT',
        asaasInstallmentId: null,
        charges: [],
        nextDueDate: PRIMEIRO_VENCIMENTO,
      });
    });
  });

  describe('recordContractCharges', () => {
    it('cada parcela vira cobrança do ano inteiro, com o crédito na primeira', async () => {
      const tx = {
        payment: {
          create: jest.fn(({ data }) => Promise.resolve({ id: 'p', ...data })),
        },
      };
      const nextDueDate = new Date('2027-09-24T12:00:00.000Z');
      const agora = new Date('2026-09-22T12:00:00.000Z');

      const payments = await recordContractCharges(tx as any, gateway as any, {
        subscriptionId: 'sub-local-1',
        asaasCustomerId: 'cus_1',
        billingType: 'CREDIT_CARD',
        cycle: 'YEARLY',
        quote: { totalCents: 161700, creditCents: 9010 },
        contract: {
          billingMode: 'ASAAS_INSTALLMENT',
          asaasSubscriptionId: null,
          asaasInstallmentId: 'ins_1',
          nextDueDate,
          charges: parcelas(12, 134.75),
          pix: null,
        },
        kind: 'CONTRACT',
        now: agora,
      });

      expect(payments).toHaveLength(12);
      const [primeira, segunda] = tx.payment.create.mock.calls.map(
        ([arg]) => arg.data,
      );
      expect(primeira).toMatchObject({
        asaasPaymentId: 'pay_1',
        periodStart: agora,
        periodEnd: nextDueDate,
        grossValue: 224.85,
        creditApplied: 90.1,
        asaasInstallmentId: 'ins_1',
        installmentNumber: 1,
        kind: 'CONTRACT',
      });
      expect(segunda).toMatchObject({
        periodEnd: nextDueDate,
        grossValue: null,
        creditApplied: null,
        installmentNumber: 2,
      });
    });
  });
});
