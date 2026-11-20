import { ConflictException } from '@nestjs/common';
import {
  CREDIT_ENFORCE_ENV,
  CREDIT_EXCEEDED_NO_VALUES,
  CreditCheckService,
  creditPartOf,
  creditRefusalWithoutValues,
  creditWithoutValues,
  holdOf,
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
  let prisma: any;
  let plan: { hasFeature: jest.Mock };
  let service: CreditCheckService;

  const client = (over: Record<string, unknown> = {}) => ({
    id: 'cli-1',
    type: 'PERSON',
    blockClient: false,
    requirePrepayment: false,
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
      isImported: false,
      // A pendente pela entrada (PA-2) tem o resto ainda sem título
      OR: [
        { status: 'APPROVED', receivable: { none: {} } },
        {
          status: 'PENDING_PAYMENT',
          holdReason: 'CREDIT_LIMIT',
          receivable: { none: { financialType: 'MAIN' } },
        },
      ],
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
    // A recusa espera a data de CREDIT_LIMIT_ENFORCE_FROM (12/11/2026)
    const env = process.env[CREDIT_ENFORCE_ENV];
    beforeEach(() => {
      process.env[CREDIT_ENFORCE_ENV] = '2026-01-01';
      prisma.receivableInstallment.aggregate.mockResolvedValue({
        _sum: { amount: 80000 },
      });
    });
    afterEach(() => {
      if (env === undefined) delete process.env[CREDIT_ENFORCE_ENV];
      else process.env[CREDIT_ENFORCE_ENV] = env;
    });

    describe('antes da data de corte', () => {
      beforeEach(() => {
        delete process.env[CREDIT_ENFORCE_ENV];
      });

      it('o limite estourado só é registrado: aprova sem recusa nem pendência', async () => {
        await expect(service.assertApproval('orc-1')).resolves.toBeNull();
      });

      it('a entrada que passaria do limite não vira pendência', async () => {
        const today = new Date();
        prisma.quotation.findUnique.mockResolvedValue(
          quotation({
            quotationPayment: {
              ...quotation().quotationPayment,
              downPayment: 10000,
              downPaymentDueDate: today,
              downPaymentCondition: { paymentMethod: { code: 'PIX' } },
            },
          }),
        );
        await expect(service.assertApproval('orc-1')).resolves.toBeNull();
      });

      it('o pagamento antecipado marcado no cliente vale já', async () => {
        prisma.quotation.findUnique.mockResolvedValue(
          quotation({ client: client({ requirePrepayment: true }) }),
        );
        await expect(service.assertApproval('orc-1')).resolves.toEqual({
          reason: 'PREPAYMENT',
          amount: 30000,
          scope: 'ALL',
        });
      });
    });

    it('o título cancelado (pendência desfeita) não conta como financeiro gerado', async () => {
      await service.quotationCredit('orc-1').catch(() => null);
      const select = prisma.quotation.findUnique.mock.calls[0][0].select;
      expect(select._count).toEqual({
        select: { receivable: { where: { status: { not: 'CANCELED' } } } },
      });
    });

    it('recusa com 409 e diz o caminho: quanto passa e a entrada sugerida (PA-2)', async () => {
      const error = await service.assertApproval('orc-1').catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      const body = error.getResponse();
      expect(body).toMatchObject({
        code: 'CREDIT_CHECK',
        issues: [
          {
            code: 'CREDIT_LIMIT_EXCEEDED',
            limit: 100000,
            used: 80000,
            requested: 30000,
            excess: 10000,
            suggestedDownPayment: 10000,
          },
        ],
      });
      // O Intl separa o R$ do número com espaço inseparável
      expect(body.message.replace(/\u00a0/g, ' ')).toBe(
        'Esta venda passa R$ 100,00 do limite de crédito do cliente (limite de R$ 1.000,00, com R$ 800,00 já em aberto). Sugestão: uma entrada de R$ 100,00, que precisa ser paga para liberar a venda. Para mudar o limite, fale com o financeiro.',
      );
    });

    it('cliente já acima do limite: a entrada sugerida é a parte a prazo inteira', async () => {
      prisma.receivableInstallment.aggregate.mockResolvedValue({
        _sum: { amount: 150000 },
      });
      const credit = await service.quotationCredit('orc-1');
      expect(credit.issues[0]).toMatchObject({
        excess: 80000,
        suggestedDownPayment: 30000,
        fullPayment: true,
      });
      // Lista Lite 19/11, item 3: não é entrada, é pagamento integral
      expect(credit.issues[0].message.replace(/\u00a0/g, ' ')).toContain(
        'será necessário o pagamento integral de R$ 300,00 à vista',
      );
    });

    it('com a entrada da diferença no ato, aprova com pendência da entrada', async () => {
      const today = new Date();
      prisma.quotation.findUnique.mockResolvedValue(
        quotation({
          quotationPayment: {
            ...quotation().quotationPayment,
            downPayment: 10000,
            downPaymentDueDate: today,
            downPaymentCondition: { paymentMethod: { code: 'PIX' } },
            quotationInstallment: [
              {
                ...quotation().quotationPayment.quotationInstallment[0],
                value: 20000,
              },
            ],
          },
        }),
      );
      await expect(service.assertApproval('orc-1')).resolves.toEqual({
        reason: 'CREDIT_LIMIT',
        amount: 10000,
        scope: 'DOWN_PAYMENT',
      });
    });

    it('cliente com "Exigir pagamento antecipado": pendência do total, mesmo dentro do limite', async () => {
      prisma.receivableInstallment.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      prisma.quotation.findUnique.mockResolvedValue(
        quotation({ client: client({ requirePrepayment: true }) }),
      );
      await expect(service.assertApproval('orc-1')).resolves.toEqual({
        reason: 'PREPAYMENT',
        amount: 30000,
        scope: 'ALL',
      });
    });

    it('dentro do limite e sem a opção: aprova sem pendência', async () => {
      prisma.receivableInstallment.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      await expect(service.assertApproval('orc-1')).resolves.toBeNull();
    });

    it('plano sem a chave não confere', async () => {
      plan.hasFeature.mockResolvedValue(false);
      await expect(service.assertApproval('orc-1')).resolves.toBeNull();
      expect(plan.hasFeature).toHaveBeenCalledWith(
        'emp-1',
        'credit_limit_enforcement',
      );
    });

    it('venda sem cliente não confere', async () => {
      prisma.quotation.findUnique.mockResolvedValue(
        quotation({ client: null }),
      );
      await expect(service.assertApproval('orc-1')).resolves.toBeNull();
    });
  });
});

describe('holdOf', () => {
  const base = { requirePrepayment: false, limit: 200000, used: 0 };
  const LATER = new Date('2026-11-14T15:00:00Z');
  const down = (value: number, code = 'PIX') => ({
    value,
    dueDate: APPROVAL,
    methodCode: code,
    kind: 'DOWN' as const,
  });
  const main = (value: number, dueDate = LATER, code = 'BOL') => ({
    value,
    dueDate,
    methodCode: code,
    kind: 'MAIN' as const,
  });
  const payment = {};

  it('o exemplo do PO: limite 2.000, venda 5.000, entrada 3.000 no ato', () => {
    // O resto (2.000, a prazo) cabe no limite; a entrada é exigida antes
    expect(
      holdOf(base, 200000, [down(300000), main(200000)], payment, APPROVAL),
    ).toEqual({
      reason: 'CREDIT_LIMIT',
      amount: 300000,
      scope: 'DOWN_PAYMENT',
    });
  });

  it('a venda inteira no Pix à vista exige antes só o que passa do limite (12/11)', () => {
    expect(
      holdOf(base, 0, [main(500000, APPROVAL, 'PIX')], payment, APPROVAL),
    ).toEqual({ reason: 'CREDIT_LIMIT', amount: 300000, scope: 'ALL' });
  });

  it('à vista dentro do limite: sem pendência', () => {
    expect(
      holdOf(base, 0, [main(150000, APPROVAL, 'PIX')], payment, APPROVAL),
    ).toBeNull();
  });

  it('cartão não fica pendente: a operadora garante', () => {
    expect(
      holdOf(
        base,
        0,
        [down(300000, 'CRD'), main(500000, APPROVAL, 'CRD')],
        payment,
        APPROVAL,
      ),
    ).toBeNull();
  });

  it('a entrada maior que a diferença: exige só o que passa do limite', () => {
    expect(
      holdOf(
        { ...base, used: 50000 },
        100000,
        [down(200000), main(100000)],
        payment,
        APPROVAL,
      ),
    ).toEqual({
      reason: 'CREDIT_LIMIT',
      amount: 150000,
      scope: 'DOWN_PAYMENT',
    });
  });

  it('sem limite cadastrado e sem a opção: nunca fica pendente', () => {
    expect(
      holdOf(
        { ...base, limit: null },
        0,
        [main(900000, APPROVAL, 'PIX')],
        payment,
        APPROVAL,
      ),
    ).toBeNull();
  });

  it('"Exigir pagamento antecipado": o total das parcelas, com a entrada', () => {
    expect(
      holdOf(
        { ...base, requirePrepayment: true },
        0,
        [down(300000), main(200000)],
        payment,
        APPROVAL,
      ),
    ).toEqual({ reason: 'PREPAYMENT', amount: 500000, scope: 'ALL' });
  });
});

describe('o crédito sem os valores (quem não vê valores)', () => {
  const limitIssue = {
    code: 'CREDIT_LIMIT_EXCEEDED',
    message: 'Esta venda passa R$ 100,00 do limite',
    excess: 10000,
    suggestedDownPayment: 10000,
  };

  it('a conferência troca o texto do limite, que leva R$', () => {
    const credit = creditWithoutValues({
      issues: [limitIssue, { code: 'CLIENT_BLOCKED', message: 'bloqueado' }],
    });
    expect(credit.issues).toEqual([
      { ...limitIssue, message: CREDIT_EXCEEDED_NO_VALUES },
      { code: 'CLIENT_BLOCKED', message: 'bloqueado' },
    ]);
  });

  it('a recusa da aprovação sai sem os números', () => {
    const body = creditRefusalWithoutValues({
      message:
        'Esta venda passa R$ 100,00 do limite de crédito do cliente (limite de R$ 1.000,00). Sugestão: uma entrada de R$ 100,00, que precisa ser paga para liberar a venda. Para mudar o limite, fale com o financeiro.',
      issues: [
        {
          code: 'CREDIT_LIMIT_EXCEEDED',
          limit: 100000,
          used: 80000,
          requested: 30000,
          excess: 10000,
          suggestedDownPayment: 10000,
        } as any,
      ],
    });
    expect(body.issues).toEqual([{ code: 'CREDIT_LIMIT_EXCEEDED' }]);
    expect(body.message).toBe(CREDIT_EXCEEDED_NO_VALUES);
    expect(body.message).not.toMatch(/R\$/);
  });
});
