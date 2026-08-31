import { aliquotasVigentes, calcularIbsCbs } from './ibs-cbs.util';

describe('ibs-cbs.util', () => {
  describe('aliquotasVigentes', () => {
    it('usa as alíquotas de teste de 2026', () => {
      const { aliquotas, faseCoberta } = aliquotasVigentes(
        new Date('2026-08-31T12:00:00Z'),
      );
      expect(aliquotas).toEqual({ ibsUf: 0.1, ibsMun: 0, cbs: 0.9 });
      expect(faseCoberta).toBe(true);
    });

    /**
     * Em 2027 a CBS passa a ser cobrada e o IBS se divide entre estadual e
     * municipal. Enquanto os valores não estiverem confirmados, a função avisa
     * que a fase não está coberta em vez de devolver alíquota inventada.
     */
    it('sinaliza fase não coberta a partir de 2027', () => {
      expect(
        aliquotasVigentes(new Date('2027-01-01T12:00:00Z')).faseCoberta,
      ).toBe(false);
    });
  });

  describe('calcularIbsCbs', () => {
    it('calcula sobre a base com as alíquotas de 2026', () => {
      const r = calcularIbsCbs(52.58, { ibsUf: 0.1, ibsMun: 0, cbs: 0.9 });
      expect(r).toEqual({
        base: 52.58,
        ibsUf: 0.05,
        ibsMun: 0,
        ibsTotal: 0.05,
        cbs: 0.47,
      });
    });

    it('soma o IBS total a partir dos valores já arredondados', () => {
      // Somar os valores cheios daria 0,05 + 0,05 = 0,11 por arredondamento do
      // total; a nota exibe as duas linhas, então o total tem de bater com elas.
      const r = calcularIbsCbs(52.58, { ibsUf: 0.1, ibsMun: 0.1, cbs: 0.9 });
      expect(r.ibsUf).toBe(0.05);
      expect(r.ibsMun).toBe(0.05);
      expect(r.ibsTotal).toBe(0.1);
    });

    it('não devolve -0 nem dízima quando a alíquota é zero', () => {
      const r = calcularIbsCbs(100, { ibsUf: 0, ibsMun: 0, cbs: 0 });
      expect(Object.is(r.ibsUf, -0)).toBe(false);
      expect(r).toEqual({
        base: 100,
        ibsUf: 0,
        ibsMun: 0,
        ibsTotal: 0,
        cbs: 0,
      });
    });
  });
});
