import {
  addCalendarCycle,
  computeComplementsChange,
  computeEvolutionCredit,
  computePlanStates,
  computeQuote,
  installmentOptions,
  QuoteInput,
} from './pricing.engine';

// Valores de produção, em centavos.
const START = {
  name: 'Atrupe Start',
  basePriceCents: 14700,
  additionalUserPriceCents: 1500,
};
const LITE = {
  name: 'Atrupe Lite',
  basePriceCents: 23000,
  additionalUserPriceCents: 1500,
};
const PRO = {
  name: 'Atrupe Pro',
  basePriceCents: 37000,
  additionalUserPriceCents: 1500,
};
const NOTA_FISCAL = {
  key: 'nota_fiscal',
  name: 'Nota Fiscal',
  priceCents: 7000,
};

const quote = (input: Partial<QuoteInput> = {}) =>
  computeQuote({ plan: START, cycle: 'MONTHLY', ...input });

describe('pricing.engine', () => {
  describe('computeQuote — ciclo', () => {
    it('mensal cobra a mensalidade cheia', () => {
      const q = quote();
      expect(q.totalCents).toBe(14700);
      expect(q.recurringCents).toBe(14700);
      expect(q.totalSuffix).toBe('/mês');
      expect(q.discounts).toEqual([]);
    });

    it('anual cobra 11 mensalidades: 1.764 − 147 = 1.617', () => {
      const q = quote({ cycle: 'YEARLY' });
      expect(q.subtotalCents).toBe(176400);
      expect(q.freeMonthCents).toBe(14700);
      expect(q.totalCents).toBe(161700);
      expect(q.recurringCents).toBe(161700);
      expect(q.totalSuffix).toBe('/ano');
      expect(q.discounts[0]).toMatchObject({
        kind: 'FREE_MONTH',
        amountCents: 14700,
      });
    });

    it('soma plano, módulos e usuários adicionais na mensalidade bruta', () => {
      const q = quote({ modules: [NOTA_FISCAL], additionalUsers: 2 });
      // 147 + 70 + 2 × 15
      expect(q.grossMonthlyCents).toBe(24700);
      expect(q.lines.map((l) => l.kind)).toEqual([
        'PLAN',
        'MODULE',
        'ADDITIONAL_USERS',
      ]);
      expect(q.lines[2]).toMatchObject({ quantity: 2, monthlyCents: 3000 });
    });

    it('recusa usuários adicionais negativos, fracionários ou acima do limite', () => {
      expect(() => quote({ additionalUsers: -1 })).toThrow(RangeError);
      expect(() => quote({ additionalUsers: 1.5 })).toThrow(RangeError);
      expect(() => quote({ additionalUsers: 21 })).toThrow(RangeError);
    });
  });

  describe('computeQuote — paridade com o cálculo atual do mensal', () => {
    // O create() legado passa a usar o motor; o valor tem de ser o mesmo.
    it('cupom percentual: round(base × p/100)', () => {
      const q = quote({
        modules: [NOTA_FISCAL],
        additionalUsers: 2,
        coupon: {
          code: 'ATRUPE20',
          discountType: 'PERCENT',
          discountValue: 20,
        },
      });
      expect(q.couponDiscountCents).toBe(4940);
      expect(q.totalCents).toBe(19760);
    });

    it('cupom de valor fixo no mensal abate uma vez', () => {
      const q = quote({
        coupon: { code: 'FIXO30', discountType: 'VALUE', discountValue: 3000 },
      });
      expect(q.totalCents).toBe(11700);
    });

    it('cupom abaixo do valor mínimo não é aplicado', () => {
      const q = quote({
        coupon: {
          code: 'GRANDE',
          discountType: 'PERCENT',
          discountValue: 20,
          minPlanValueCents: 50000,
        },
      });
      expect(q.coupon).toEqual({
        code: 'GRANDE',
        applied: false,
        reason: 'MIN_VALUE',
        minPlanValueCents: 50000,
      });
      expect(q.totalCents).toBe(14700);
    });
  });

  describe('computeQuote — cupom', () => {
    it('no anual, o percentual incide depois do mês grátis', () => {
      const q = quote({
        cycle: 'YEARLY',
        modules: [NOTA_FISCAL],
        additionalUsers: 2,
        coupon: {
          code: 'ATRUPE20',
          discountType: 'PERCENT',
          discountValue: 20,
        },
      });
      // 247 × 12 = 2.964 − 247 = 2.717; −20% = 543,40
      expect(q.couponDiscountCents).toBe(54340);
      expect(q.totalCents).toBe(217360);
    });

    it('no anual, o valor fixo abate doze vezes', () => {
      const q = quote({
        cycle: 'YEARLY',
        coupon: { code: 'FIXO30', discountType: 'VALUE', discountValue: 3000 },
      });
      expect(q.couponDiscountCents).toBe(36000);
      expect(q.totalCents).toBe(161700 - 36000);
    });

    it('o desconto do cupom nunca passa do valor devido', () => {
      const q = quote({
        coupon: { code: 'TUDO', discountType: 'VALUE', discountValue: 999999 },
      });
      expect(q.totalCents).toBe(0);
    });

    it('não vale na renovação', () => {
      const q = quote({
        cycle: 'YEARLY',
        coupon: {
          code: 'ATRUPE20',
          discountType: 'PERCENT',
          discountValue: 20,
        },
      });
      expect(q.totalCents).toBeLessThan(q.recurringCents);
      expect(q.recurringCents).toBe(161700);
    });
  });

  describe('computeQuote — parcelamento', () => {
    it('anual no cartão oferece até 12x: 12x de 134,75', () => {
      const q = quote({
        cycle: 'YEARLY',
        billingType: 'CREDIT_CARD',
        installmentCount: 12,
      });
      expect(q.installments.allowed).toBe(true);
      expect(q.installments.max).toBe(12);
      expect(q.installments.selected).toBe(12);
      expect(q.installments.options[11]).toEqual({
        count: 12,
        amountCents: 13475,
        lastAmountCents: 13475,
      });
    });

    it('não parcela no mensal nem fora do cartão', () => {
      expect(quote({ billingType: 'CREDIT_CARD' }).installments.allowed).toBe(
        false,
      );
      expect(
        quote({ cycle: 'YEARLY', billingType: 'PIX' }).installments.allowed,
      ).toBe(false);
    });

    it('pedido de parcelas fora das opções cai para 1x', () => {
      const q = quote({
        cycle: 'YEARLY',
        billingType: 'PIX',
        installmentCount: 12,
      });
      expect(q.installments.selected).toBe(1);
    });

    it('as parcelas somam exatamente o total', () => {
      installmentOptions(392903).forEach((o) => {
        expect(o.amountCents * (o.count - 1) + o.lastAmountCents).toBe(392903);
      });
    });

    it('não oferece parcela abaixo do mínimo do gateway', () => {
      expect(installmentOptions(2000).map((o) => o.count)).toEqual([
        1, 2, 3, 4,
      ]);
    });
  });

  describe('computeEvolutionCredit', () => {
    // Relógio fixo: ciclo 13/08 → 13/09 = 31 dias, 19 restantes em 25/08.
    const CONTRATADA_EM = new Date('2026-08-13T12:00:00.000Z');
    const AGORA = new Date('2026-08-25T12:00:00.000Z');
    const cicloEmCurso = {
      grossCents: 23000,
      start: CONTRATADA_EM,
      end: new Date('2026-09-13T12:00:00.000Z'),
    };
    const liteMensalPago = {
      contractedAt: CONTRATADA_EM,
      paidPeriods: [cicloEmCurso],
      planName: 'Atrupe Lite',
      now: AGORA,
    };

    it('credita os dias não usados: 230 × 19/31 = 140,97', () => {
      expect(computeEvolutionCredit(liteMensalPago)).toEqual({
        creditCents: 14097,
        remainingDays: 19,
        totalDays: 31,
        planName: 'Atrupe Lite',
      });
    });

    it('o parcelamento é calculado sobre o total já líquido do crédito', () => {
      const credit = computeEvolutionCredit(liteMensalPago);
      const q = computeQuote({
        plan: PRO,
        cycle: 'YEARLY',
        billingType: 'CREDIT_CARD',
        installmentCount: 12,
        evolutionCredit: credit,
      });
      // Pro anual 4.070 − 140,97 = 3.929,03; em 12x dá 327,42
      expect(q.totalCents).toBe(392903);
      expect(q.installments.options[11].amountCents).toBe(32742);
    });

    it('o crédito é o último desconto, depois do cupom', () => {
      const q = computeQuote({
        plan: PRO,
        cycle: 'MONTHLY',
        coupon: {
          code: 'ATRUPE20',
          discountType: 'PERCENT',
          discountValue: 20,
        },
        evolutionCredit: computeEvolutionCredit(liteMensalPago),
      });
      expect(q.discounts.map((d) => d.kind)).toEqual([
        'COUPON',
        'EVOLUTION_CREDIT',
      ]);
      // 370 − 74 = 296; − 140,97 = 155,03
      expect(q.totalCents).toBe(15503);
    });

    it('crédito maior que a fatura zera o total, sem ficar negativo', () => {
      const q = computeQuote({
        plan: LITE,
        cycle: 'MONTHLY',
        evolutionCredit: {
          creditCents: 400000,
          remainingDays: 360,
          totalDays: 365,
          planName: 'Atrupe Pro',
        },
      });
      expect(q.totalCents).toBe(0);
      expect(q.creditCents).toBe(23000);
      expect(q.installments.allowed).toBe(false);
    });

    it('mede o ciclo da última renovação paga, não o da contratação', () => {
      // Contratada em 13/06: em 25/08 o ciclo em curso é o da renovação de
      // 13/08. Medido a partir da contratação, não havia crédito nenhum.
      const credit = computeEvolutionCredit({
        ...liteMensalPago,
        contractedAt: new Date('2026-06-13T12:00:00.000Z'),
        paidPeriods: [
          {
            grossCents: 23000,
            start: new Date('2026-07-13T12:00:00.000Z'),
            end: CONTRATADA_EM,
          },
          cicloEmCurso,
        ],
      });
      expect(credit).toMatchObject({ creditCents: 14097, remainingDays: 19 });
    });

    it('renovação paga adiantada é creditada inteira', () => {
      const credit = computeEvolutionCredit({
        ...liteMensalPago,
        paidPeriods: [
          cicloEmCurso,
          {
            grossCents: 23000,
            start: new Date('2026-09-13T12:00:00.000Z'),
            end: new Date('2026-10-13T12:00:00.000Z'),
          },
        ],
      });
      // 140,97 do ciclo em curso + 230,00 do seguinte, que nem começou.
      expect(credit).toEqual({
        creditCents: 14097 + 23000,
        remainingDays: 49,
        totalDays: 61,
        planName: 'Atrupe Lite',
      });
    });

    it('sem data de contratação não há crédito', () => {
      expect(
        computeEvolutionCredit({ ...liteMensalPago, contractedAt: null }),
      ).toBeNull();
    });

    it('sem cobrança paga não há crédito', () => {
      expect(
        computeEvolutionCredit({ ...liteMensalPago, paidPeriods: [] }),
      ).toBeNull();
    });

    it('ciclo já encerrado não gera crédito', () => {
      expect(
        computeEvolutionCredit({
          ...liteMensalPago,
          now: new Date('2026-09-20T12:00:00.000Z'),
        }),
      ).toBeNull();
    });
  });

  describe('computeComplementsChange', () => {
    const startMensal = {
      currentRecurringCents: 14700,
      cycle: 'MONTHLY' as const,
      additionalUserPriceCents: 1500,
      currentAdditionalUsers: 0,
      targetAdditionalUsers: 0,
    };

    it('soma o módulo à próxima mensalidade e não cobra nada agora', () => {
      expect(
        computeComplementsChange({
          ...startMensal,
          addedModules: [NOTA_FISCAL],
        }),
      ).toEqual({
        lines: [{ kind: 'MODULE', label: 'Nota Fiscal', monthlyCents: 7000 }],
        deltaMonthlyCents: 7000,
        deltaCycleCents: 7000,
        currentRecurringCents: 14700,
        recurringCents: 21700,
        chargedNowCents: 0,
      });
    });

    it('usuários adicionais contam só os que entram', () => {
      const change = computeComplementsChange({
        ...startMensal,
        currentRecurringCents: 17700,
        currentAdditionalUsers: 2,
        targetAdditionalUsers: 5,
      });
      expect(change.lines).toEqual([
        {
          kind: 'ADDITIONAL_USERS',
          label: 'Usuários adicionais',
          quantity: 3,
          monthlyCents: 4500,
        },
      ]);
      expect(change.recurringCents).toBe(22200);
    });

    it('parte da renovação atual, sem reprecificar o plano', () => {
      // Assinatura antiga com desconto recorrente: R$ 117,60 em vez de 147.
      const change = computeComplementsChange({
        ...startMensal,
        currentRecurringCents: 11760,
        addedModules: [NOTA_FISCAL],
      });
      expect(change.recurringCents).toBe(18760);
    });

    it('retirar um módulo tira o valor dele da renovação', () => {
      const change = computeComplementsChange({
        ...startMensal,
        currentRecurringCents: 21700,
        removedModules: [NOTA_FISCAL],
      });
      expect(change.deltaCycleCents).toBe(-7000);
      expect(change.recurringCents).toBe(14700);
    });

    it('recusa quantidade de usuários inválida', () => {
      expect(() =>
        computeComplementsChange({ ...startMensal, targetAdditionalUsers: -1 }),
      ).toThrow(RangeError);
      expect(() =>
        computeComplementsChange({
          ...startMensal,
          targetAdditionalUsers: 1.5,
        }),
      ).toThrow(RangeError);
    });
  });

  describe('addCalendarCycle', () => {
    it('um mês de calendário', () => {
      expect(
        addCalendarCycle(
          new Date('2026-08-13T12:00:00.000Z'),
          'MONTHLY',
        ).toISOString(),
      ).toBe('2026-09-13T12:00:00.000Z');
    });

    it('limita ao último dia do mês em vez de transbordar', () => {
      expect(
        addCalendarCycle(
          new Date('2026-01-31T00:00:00.000Z'),
          'MONTHLY',
        ).toISOString(),
      ).toBe('2026-02-28T00:00:00.000Z');
      expect(
        addCalendarCycle(
          new Date('2024-02-29T00:00:00.000Z'),
          'YEARLY',
        ).toISOString(),
      ).toBe('2025-02-28T00:00:00.000Z');
    });
  });

  describe('computePlanStates', () => {
    const plans = (activeTypes: string[]) =>
      ['TRIAL', 'FULL', 'START', 'ELITE', 'LITE', 'PRO'].map((t) => ({
        id: `plan-${t}`,
        planType: t,
        isActive: activeTypes.includes(t),
      }));

    const states = (items: ReturnType<typeof computePlanStates>) =>
      Object.fromEntries(
        items.map((i) => [
          i.planType,
          i.reason ? `${i.state}:${i.reason}` : i.state,
        ]),
      );

    it('sem contratação, só o START é oferecido; o TRIAL fica fora', () => {
      const items = computePlanStates({
        plans: plans(['START']),
        currentPlanType: null,
        hasOpenCharge: false,
      });
      expect(items.map((i) => i.planType)).toEqual([
        'START',
        'LITE',
        'PRO',
        'ELITE',
        'FULL',
      ]);
      expect(states(items)).toEqual({
        START: 'ELEGIVEL',
        LITE: 'BLOQUEADO:SEQUENCE',
        PRO: 'BLOQUEADO:SEQUENCE',
        ELITE: 'BLOQUEADO:SEQUENCE',
        FULL: 'BLOQUEADO:SEQUENCE',
      });
    });

    it('o próximo ainda não liberado aparece em breve, não como contratável', () => {
      const items = computePlanStates({
        plans: plans(['START']),
        currentPlanType: 'START',
        hasOpenCharge: false,
      });
      expect(states(items)).toMatchObject({
        START: 'ATUAL',
        LITE: 'EM_BREVE:NOT_RELEASED',
        PRO: 'BLOQUEADO:SEQUENCE',
      });
    });

    it('o próximo liberado é o único elegível', () => {
      const items = computePlanStates({
        plans: plans(['START', 'LITE']),
        currentPlanType: 'START',
        hasOpenCharge: false,
      });
      expect(states(items)).toMatchObject({
        START: 'ATUAL',
        LITE: 'ELEGIVEL',
        PRO: 'BLOQUEADO:SEQUENCE',
      });
    });

    it('com cobrança em aberto nada é oferecido', () => {
      const items = computePlanStates({
        plans: plans(['START', 'LITE', 'PRO']),
        currentPlanType: 'LITE',
        hasOpenCharge: true,
      });
      expect(states(items)).toMatchObject({
        START: 'CONCLUIDO',
        LITE: 'ATUAL',
        PRO: 'BLOQUEADO:OPEN_CHARGE',
      });
    });
  });
});
