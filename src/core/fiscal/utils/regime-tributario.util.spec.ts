import {
  isMei,
  isOptanteSimples,
  isRegimeNormal,
  regimeEspecialPadraoNfse,
} from './regime-tributario.util';

/**
 * O MEI é o caso que quebra a comparação numérica: é o maior código da lista
 * e, ainda assim, o mais próximo do Simples Nacional. Cada teste aqui existe
 * porque havia um `>= 3` ou um `<= 2` espalhado pelo módulo fiscal que erraria
 * nesse valor.
 */
describe('classificação do CRT', () => {
  describe('isRegimeNormal', () => {
    it.each([
      [undefined, false],
      [null, false],
      [1, false],
      [2, false],
      [3, true],
    ])('CRT %p → %p', (crt, esperado) => {
      expect(isRegimeNormal(crt)).toBe(esperado);
    });

    /** Com `>= 3` o MEI destacaria ICMS como Lucro Real. */
    it('CRT 4 (MEI) não é Regime Normal, apesar de ser maior que 3', () => {
      expect(isRegimeNormal(4)).toBe(false);
    });
  });

  describe('isOptanteSimples', () => {
    it.each([
      [undefined, true],
      [null, true],
      [1, true],
      [2, true],
      [3, false],
    ])('CRT %p → %p', (crt, esperado) => {
      expect(isOptanteSimples(crt)).toBe(esperado);
    });

    /** Com `<= 2` o MEI ficaria fora do Simples na ST e no IBS/CBS. */
    it('CRT 4 (MEI) é optante do Simples', () => {
      expect(isOptanteSimples(4)).toBe(true);
    });
  });

  it('isMei só reconhece o 4', () => {
    expect(isMei(4)).toBe(true);
    for (const crt of [undefined, null, 1, 2, 3]) {
      expect(isMei(crt)).toBe(false);
    }
  });

  /**
   * Tabela do provedor: 5 = Microempresário Individual, 6 = ME/EPP. Fora
   * dessas duas faixas a tag é omitida — declarar o regime errado numa nota
   * fiscal é pior do que não declarar um campo opcional.
   */
  describe('regimeEspecialPadraoNfse', () => {
    it('MEI declara 5', () => {
      expect(regimeEspecialPadraoNfse(4)).toBe(5);
    });

    it('Simples Nacional declara 6', () => {
      expect(regimeEspecialPadraoNfse(1)).toBe(6);
    });

    it('excesso de sublimite e Regime Normal ficam sem padrão', () => {
      expect(regimeEspecialPadraoNfse(2)).toBeUndefined();
      expect(regimeEspecialPadraoNfse(3)).toBeUndefined();
    });

    /**
     * Diferente das demais funções: sem CRT não se declara enquadramento
     * nenhum na nota. Tratar a ausência como Simples aqui faria a tag aparecer
     * em emissores que hoje a omitem.
     */
    it('sem CRT não declara nada', () => {
      expect(regimeEspecialPadraoNfse(null)).toBeUndefined();
      expect(regimeEspecialPadraoNfse(undefined)).toBeUndefined();
    });
  });
});
