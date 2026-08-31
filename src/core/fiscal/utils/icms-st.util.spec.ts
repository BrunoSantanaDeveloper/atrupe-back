import { calcularMvaAjustada, resolverMva } from './icms-st.util';

describe('icms-st.util', () => {
  describe('calcularMvaAjustada', () => {
    /**
     * Exemplo clássico dos protocolos: MVA original 40%, entrada de outra UF a
     * 12%, alíquota interna do destino 18%.
     *   [(1,40 x 0,88) / 0,82] - 1 = 0,5024... -> 50,24%
     */
    it('ajusta a margem pela diferença entre a interestadual e a interna', () => {
      expect(
        calcularMvaAjustada({
          mvaOriginal: 40,
          aliquotaInterestadual: 12,
          aliquotaInterna: 18,
        }),
      ).toBe(50.24);
    });

    it('ajusta mais quando a entrada vem a 7%', () => {
      // [(1,40 x 0,93) / 0,82] - 1 = 0,5878... -> 58,78%
      expect(
        calcularMvaAjustada({
          mvaOriginal: 40,
          aliquotaInterestadual: 7,
          aliquotaInterna: 18,
        }),
      ).toBe(58.78);
    });

    it('mantém a original quando a interna é igual à interestadual', () => {
      expect(
        calcularMvaAjustada({
          mvaOriginal: 40,
          aliquotaInterestadual: 18,
          aliquotaInterna: 18,
        }),
      ).toBe(40);
    });

    /** Ajuste negativo não existe: o piso é a MVA original. */
    it('não devolve margem menor que a original', () => {
      expect(
        calcularMvaAjustada({
          mvaOriginal: 40,
          aliquotaInterestadual: 18,
          aliquotaInterna: 12,
        }),
      ).toBe(40);
    });

    it('recusa entrada inválida em vez de devolver Infinity', () => {
      expect(
        calcularMvaAjustada({
          mvaOriginal: 40,
          aliquotaInterestadual: 12,
          aliquotaInterna: 100,
        }),
      ).toBeNull();
      expect(
        calcularMvaAjustada({
          mvaOriginal: -1,
          aliquotaInterestadual: 12,
          aliquotaInterna: 18,
        }),
      ).toBeNull();
      expect(
        calcularMvaAjustada({
          mvaOriginal: Number.NaN,
          aliquotaInterestadual: 12,
          aliquotaInterna: 18,
        }),
      ).toBeNull();
    });
  });

  describe('resolverMva', () => {
    const base = {
      mvaOriginal: 40,
      aliquotaInterestadual: 12,
      aliquotaInterna: 18,
    };

    it('ajusta para o contribuinte do regime normal em operação interestadual', () => {
      expect(
        resolverMva({ ...base, optanteSimples: false, interestadual: true }),
      ).toBe(50.24);
    });

    /**
     * Convênio ICMS 35/2011: o optante do Simples, como substituto tributário,
     * não aplica MVA ajustada em operação interestadual. Vale para todos os
     * emissores de hoje, que são Simples Nacional.
     */
    it('não ajusta para optante do Simples Nacional', () => {
      expect(
        resolverMva({ ...base, optanteSimples: true, interestadual: true }),
      ).toBe(40);
    });

    it('não ajusta em operação dentro da mesma UF', () => {
      expect(
        resolverMva({ ...base, optanteSimples: false, interestadual: false }),
      ).toBe(40);
    });

    it('recusa MVA original inválida', () => {
      expect(
        resolverMva({
          ...base,
          mvaOriginal: Number.NaN,
          optanteSimples: false,
          interestadual: true,
        }),
      ).toBeNull();
    });
  });
});
