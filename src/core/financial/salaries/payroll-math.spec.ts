import {
  PayrollLine,
  chargesOf,
  coherent,
  employeeTotalsOf,
  finalCostOf,
  legacyOf,
  payrollEntriesOf,
  setupFromTemplate,
  valuesOf,
} from './payroll-math';

const line = (over: Partial<PayrollLine>): PayrollLine => ({
  isSet: true,
  behavior: null,
  increase: null,
  discount: null,
  type: 'INCREASE',
  amount: 0,
  ...over,
});

describe('payroll-math', () => {
  describe('a linha de antes, sem comportamento', () => {
    it('lê o type/amount como acréscimo, desconto ou adiantamento', () => {
      expect(valuesOf(line({ type: 'INCREASE', amount: 150000 }))).toEqual({
        behavior: 'ONLY_INCREASE',
        increase: 150000,
        discount: 0,
      });
      expect(valuesOf(line({ type: 'DISCOUNT', amount: 2000 }))).toEqual({
        behavior: 'ONLY_DISCOUNT',
        increase: 0,
        discount: 2000,
      });
      expect(valuesOf(line({ type: 'ADVANCE', amount: 50000 }))).toEqual({
        behavior: 'ADVANCE',
        increase: 50000,
        discount: 0,
      });
    });
  });

  describe('a folha mensal', () => {
    it('acréscimo, desconto e adiantamento dão o lançamento de sempre', () => {
      // Valor com fração: o backfill arredonda o acréscimo, a folha não
      const rows = [
        line({
          behavior: 'ONLY_INCREASE',
          increase: 150001,
          discount: 0,
          type: 'INCREASE',
          amount: 150000.6,
        }),
        line({
          behavior: 'ONLY_DISCOUNT',
          increase: 0,
          discount: 2000,
          type: 'DISCOUNT',
          amount: 2000,
        }),
        line({
          behavior: 'ADVANCE',
          increase: 50000,
          discount: 0,
          type: 'ADVANCE',
          amount: 50000,
        }),
      ];
      expect(rows.flatMap(payrollEntriesOf)).toEqual([
        { type: 'INCREASE', amount: 150000.6 },
        { type: 'DISCOUNT', amount: 2000 },
        { type: 'ADVANCE', amount: 50000 },
      ]);
    });

    it('a linha de antes sai igual', () => {
      expect(
        payrollEntriesOf(line({ type: 'DISCOUNT', amount: 1234.5 })),
      ).toEqual([{ type: 'DISCOUNT', amount: 1234.5 }]);
    });

    it('a provisão não é paga no mês', () => {
      expect(
        payrollEntriesOf(
          line({
            behavior: 'PROVISION',
            increase: 40000,
            discount: 0,
            type: 'INCREASE',
            amount: 40000,
          }),
        ),
      ).toEqual([]);
    });

    it('acréscimo e desconto viram dois lançamentos', () => {
      expect(
        payrollEntriesOf(
          line({
            behavior: 'INCREASE_AND_DISCOUNT',
            increase: 40000,
            discount: 40000,
            type: 'INCREASE',
            amount: 0,
          }),
        ),
      ).toEqual([
        { type: 'INCREASE', amount: 40000 },
        { type: 'DISCOUNT', amount: 40000 },
      ]);
    });
  });

  describe('o type/amount em sincronia', () => {
    it('acréscimo e desconto ficam com o saldo, do lado dele', () => {
      expect(legacyOf('INCREASE_AND_DISCOUNT', 10000, 25000)).toEqual({
        type: 'DISCOUNT',
        amount: 15000,
      });
      expect(legacyOf('INCREASE_AND_DISCOUNT', 40000, 40000)).toEqual({
        type: 'INCREASE',
        amount: 0,
      });
      expect(legacyOf('ADVANCE', 50000, 0)).toEqual({
        type: 'ADVANCE',
        amount: 50000,
      });
    });

    it('o comportamento manda no que pode ter valor', () => {
      expect(coherent('ONLY_INCREASE', 100, 50)).toEqual({
        behavior: 'ONLY_INCREASE',
        increase: 100,
        discount: 0,
      });
      expect(coherent('ONLY_DISCOUNT', 100, 50)).toEqual({
        behavior: 'ONLY_DISCOUNT',
        increase: 0,
        discount: 50,
      });
      expect(coherent('PROVISION', 100, 50).discount).toBe(0);
    });
  });

  describe('o custo e a folha a pagar (contrato 2300)', () => {
    // O exemplo do contrato: salário 5.000,00 e INSS 8 % nos dois lados
    const rows = [
      line({
        behavior: 'ONLY_INCREASE',
        increase: 500000,
        discount: 0,
        type: 'INCREASE',
        amount: 500000,
      }),
      line({
        behavior: 'INCREASE_AND_DISCOUNT',
        increase: 40000,
        discount: 40000,
        type: 'INCREASE',
        amount: 0,
      }),
      line({
        behavior: 'PROVISION',
        increase: 40000,
        discount: 0,
        type: 'INCREASE',
        amount: 40000,
      }),
      line({
        behavior: 'ADVANCE',
        increase: 100000,
        discount: 0,
        type: 'ADVANCE',
        amount: 100000,
      }),
      line({
        isSet: false,
        behavior: 'ONLY_INCREASE',
        increase: 0,
        discount: 0,
        type: 'INCREASE',
        amount: 0,
      }),
    ];

    it('o INSS nos dois lados não custa', () => {
      expect(finalCostOf(rows[1])).toBe(0);
    });

    it('o custo soma a provisão; a folha a pagar não', () => {
      expect(employeeTotalsOf(rows)).toEqual({
        employeeCost: 540000,
        employeePayroll: 500000,
        totalIncrease: 580000,
        totalDiscount: 40000,
        employeeProvision: 40000,
      });
    });

    it('o adiantamento não é custo a mais', () => {
      expect(finalCostOf(rows[3])).toBe(0);
    });
  });

  describe('os encargos da CLT (F-14)', () => {
    it('INSS e FGTS pela alíquota; 13º e férias 1/12 com os encargos', () => {
      expect(chargesOf('CLT', 500000, { inss: 8, fgts: 8 })).toEqual({
        INSS: { increase: 40000, discount: 40000 },
        FGTS: { increase: 40000, discount: 0 },
        THIRTEENTH: { increase: 48333, discount: 0 },
        VACATION: { increase: 48333, discount: 0 },
      });
    });

    it('pró-labore, MEI/PJ e quem não tem salário ficam sem encargos', () => {
      expect(chargesOf('PRO_LABORE', 500000, { inss: 8, fgts: 8 })).toBeNull();
      expect(chargesOf('MEI_PJ', 500000, { inss: 8, fgts: 8 })).toBeNull();
      expect(chargesOf(null, 500000, { inss: 8, fgts: 8 })).toBeNull();
      expect(chargesOf('CLT', 0, { inss: 8, fgts: 8 })).toBeNull();
    });
  });

  describe('a linha nova a partir do item', () => {
    const template = {
      name: 'Vale-transporte',
      type: 'DISCOUNT' as const,
      defaultAmount: 1500,
      behavior: null,
      defaultIncrease: null,
      defaultDiscount: null,
      derivedFromSalary: false,
    };

    it('o item de antes copia o type/amount', () => {
      expect(setupFromTemplate(template)).toEqual({
        name: 'Vale-transporte',
        type: 'DISCOUNT',
        amount: 1500,
        isSet: true,
      });
    });

    it('o item com comportamento leva os valores e o type/amount junto', () => {
      expect(
        setupFromTemplate({
          ...template,
          name: 'Plano de saúde',
          type: 'INCREASE',
          behavior: 'INCREASE_AND_DISCOUNT',
          defaultIncrease: 10000,
          defaultDiscount: 25000,
        }),
      ).toEqual({
        name: 'Plano de saúde',
        behavior: 'INCREASE_AND_DISCOUNT',
        increase: 10000,
        discount: 25000,
        type: 'DISCOUNT',
        amount: 15000,
        isSet: true,
      });
    });

    it('o encargo nasce fora da folha: entra pelo salário base', () => {
      expect(
        setupFromTemplate({
          ...template,
          name: 'FGTS',
          type: 'INCREASE',
          behavior: 'PROVISION',
          defaultIncrease: 0,
          defaultDiscount: 0,
          derivedFromSalary: true,
        }).isSet,
      ).toBe(false);
    });
  });
});
