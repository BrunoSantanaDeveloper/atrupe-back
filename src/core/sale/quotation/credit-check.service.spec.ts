import { ConflictException, Logger } from '@nestjs/common';
import {
  CREDIT_ENFORCE_ENV,
  CREDIT_LIMIT_EXCEEDED_MESSAGE,
  CreditCheckService,
  creditPartOf,
} from './credit-check.service';

const APPROVAL = new Date('2026-10-14T15:00:00Z');
const day = (iso: string) => new Date(iso);

describe('creditPartOf', () => {
  it('conta só o que vence depois do dia da aprovação, fora cartão', () => {
    expect(
      creditPartOf(
        [
          // No dia (São Paulo): paga no ato
          {
            value: 1000,
            dueDate: day('2026-10-14T12:00:00Z'),
            methodCode: 'PIX',
          },
          // 23h de 14/10 em São Paulo ainda é o dia da aprovação
          {
            value: 2000,
            dueDate: day('2026-10-15T02:00:00Z'),
            methodCode: 'BOL',
          },
          // Cartão: da operadora
          {
            value: 4000,
            dueDate: day('2026-11-14T12:00:00Z'),
            methodCode: 'CRD',
          },
          {
            value: 8000,
            dueDate: day('2026-11-14T12:00:00Z'),
            methodCode: 'BOL',
          },
          {
            value: 16000,
            dueDate: day('2026-12-14T12:00:00Z'),
            methodCode: null,
          },
          // Entrada sem data: no ato
          { value: 32000, dueDate: null, methodCode: 'DIN' },
        ],
        APPROVAL,
      ),
    ).toBe(24000);
  });
});

describe('CreditCheckService', () => {
  const env = process.env[CREDIT_ENFORCE_ENV];
  let prisma: any;
  let plan: { hasFeature: jest.Mock };
  let service: CreditCheckService;

  const client = (over: Record<string, unknown> = {}) => ({
    id: 'cli-1',
    type: 'PERSON',
    blockClient: false,
    maxValue: 100000,
    paymentConditions: [],
    ...over,
  });
  const quotation = (over: Record<string, unknown> = {}) => ({
    companyId: 'emp-1',
    clientId: 'cli-1',
    approvedAt: null,
    _count: { receivable: 0 },
    client: client(),
    quotationPayment: {
      downPayment: 0,
      downPaymentAdditionalFee: 0,
      downPaymentDueDate: null,
      downPaymentCondition: null,
      downPaymentConditionId: null,
      paymentCondition: { id: 'cond-bol', name: 'Boleto 30' },
      quotationInstallment: [
        {
          value: 30000,
          additionalFee: 0,
          dueDate: new Date(Date.now() + 30 * 86400000),
          paymentConditionId: 'cond-bol',
          paymentCondition: { paymentMethod: { code: 'BOL' } },
        },
      ],
    },
    ...over,
  });

  beforeEach(() => {
    delete process.env[CREDIT_ENFORCE_ENV];
    prisma = {
      client: { findFirst: jest.fn().mockResolvedValue(client()) },
      quotation: {
        findUnique: jest.fn().mockResolvedValue(quotation()),
        findMany: jest.fn().mockResolvedValue([]),
      },
      creditLimitDefault: { findFirst: jest.fn().mockResolvedValue(null) },
      receivableInstallment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 50000 } }),
      },
      paymentCondition: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'cond-bol', name: 'Boleto 30' }]),
      },
    };
    plan = { hasFeature: jest.fn().mockResolvedValue(true) };
    service = new CreditCheckService(prisma, plan as any);
  });

  afterAll(() => {
    if (env === undefined) delete process.env[CREDIT_ENFORCE_ENV];
    else process.env[CREDIT_ENFORCE_ENV] = env;
  });

  it('em aberto + esta venda acima do limite do cliente: recusa pelo limite', async () => {
    prisma.receivableInstallment.aggregate.mockResolvedValue({
      _sum: { amount: 80000 },
    });
    const credit = await service.quotationCredit('orc-1');
    expect(credit).toMatchObject({
      limit: 100000,
      openBalance: 80000,
      used: 80000,
      requested: 30000,
      available: 20000,
    });
    expect(credit.issues.map((i) => i.code)).toEqual(['CREDIT_LIMIT_EXCEEDED']);
    // Parcelas pendentes ou vencidas, do cliente, fora as de cartão
    expect(
      prisma.receivableInstallment.aggregate.mock.calls[0][0].where,
    ).toEqual(
      expect.objectContaining({
        status: { in: ['PENDING', 'OVERDUE'] },
        receivable: {
          companyId: 'emp-1',
          clientId: 'cli-1',
          status: { not: 'CANCELED' },
        },
      }),
    );
  });

  it('as aprovadas sem título entram no usado, sem contar esta venda', async () => {
    prisma.quotation.findMany.mockResolvedValue([
      {
        approvedAt: new Date(),
        quotationPayment: quotation().quotationPayment,
      },
    ]);
    const credit = await service.quotationCredit('orc-1');
    expect(credit.pendingApproved).toBe(30000);
    expect(credit.used).toBe(80000);
    const where = prisma.quotation.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      clientId: 'cli-1',
      status: 'APPROVED',
      isImported: false,
      receivable: { none: {} },
    });
    expect(where.NOT).toEqual([
      { order: { is: { status: 'CANCELED' } } },
      { id: 'orc-1' },
    ]);
  });

  it('sem limite no cliente, vale o padrão da empresa; sem nenhum, não confere', async () => {
    prisma.quotation.findUnique.mockResolvedValue(
      quotation({ client: client({ maxValue: 0 }) }),
    );
    prisma.creditLimitDefault.findFirst.mockResolvedValue({
      maxValue: 60000,
      paymentConditions: [],
    });
    expect((await service.quotationCredit('orc-1')).limit).toBe(60000);

    prisma.creditLimitDefault.findFirst.mockResolvedValue(null);
    const none = await service.quotationCredit('orc-1');
    expect(none.limit).toBeNull();
    expect(none.issues).toEqual([]);
  });

  it('venda paga no ato não passa do limite, mesmo com o cliente acima dele', async () => {
    prisma.receivableInstallment.aggregate.mockResolvedValue({
      _sum: { amount: 999999 },
    });
    const paid = quotation();
    paid.quotationPayment.quotationInstallment[0].dueDate = new Date();
    prisma.quotation.findUnique.mockResolvedValue(paid);
    const credit = await service.quotationCredit('orc-1');
    expect(credit.requested).toBe(0);
    expect(credit.issues).toEqual([]);
  });

  it('com título já gerado, a venda está no saldo em aberto: não soma de novo', async () => {
    prisma.quotation.findUnique.mockResolvedValue(
      quotation({ _count: { receivable: 1 } }),
    );
    expect((await service.quotationCredit('orc-1')).requested).toBe(0);
  });

  it('cliente bloqueado e condição fora das permitidas', async () => {
    prisma.quotation.findUnique.mockResolvedValue(
      quotation({
        client: client({
          blockClient: true,
          paymentConditions: [{ paymentConditionId: 'cond-pix' }],
        }),
      }),
    );
    const credit = await service.quotationCredit('orc-1');
    expect(credit.allowedConditionIds).toEqual(['cond-pix']);
    expect(credit.issues).toEqual([
      expect.objectContaining({ code: 'CLIENT_BLOCKED' }),
      {
        code: 'CONDITION_NOT_ALLOWED',
        message:
          'A condição Boleto 30 não está entre as permitidas para este cliente.',
        conditions: [{ id: 'cond-bol', name: 'Boleto 30' }],
      },
    ]);
  });

  it('nenhuma condição marcada no cliente nem no padrão: todas valem', async () => {
    prisma.creditLimitDefault.findFirst.mockResolvedValue({
      maxValue: 0,
      paymentConditions: [],
    });
    const credit = await service.quotationCredit('orc-1');
    expect(credit.allowedConditionIds).toBeNull();
    expect(prisma.paymentCondition.findMany).not.toHaveBeenCalled();
  });

  describe('assertApproval', () => {
    beforeEach(() => {
      prisma.receivableInstallment.aggregate.mockResolvedValue({
        _sum: { amount: 80000 },
      });
    });

    it('antes da data de corte só registra no log', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      await expect(service.assertApproval('orc-1')).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('CREDIT_LIMIT_EXCEEDED'),
      );
      warn.mockRestore();
    });

    it('depois da data, recusa com 409 sem valores na mensagem', async () => {
      process.env[CREDIT_ENFORCE_ENV] = '2026-01-01';
      const error = await service.assertApproval('orc-1').catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      const body = error.getResponse();
      expect(body).toMatchObject({
        code: 'CREDIT_CHECK',
        issues: [{ code: 'CREDIT_LIMIT_EXCEEDED' }],
      });
      expect(body.message).toContain(CREDIT_LIMIT_EXCEEDED_MESSAGE);
      expect(body.message).not.toMatch(/[0-9]/);
    });

    it('plano sem a chave não confere', async () => {
      process.env[CREDIT_ENFORCE_ENV] = '2026-01-01';
      plan.hasFeature.mockResolvedValue(false);
      await expect(service.assertApproval('orc-1')).resolves.toBeUndefined();
      expect(plan.hasFeature).toHaveBeenCalledWith(
        'emp-1',
        'credit_limit_enforcement',
      );
    });

    it('venda sem cliente não confere', async () => {
      process.env[CREDIT_ENFORCE_ENV] = '2026-01-01';
      prisma.quotation.findUnique.mockResolvedValue(
        quotation({ client: null }),
      );
      await expect(service.assertApproval('orc-1')).resolves.toBeUndefined();
    });
  });
});
