import {
  defaultsCadastroFiscal,
  isRegimeNormal,
} from './product-fiscal-defaults.util';

describe('defaultsCadastroFiscal', () => {
  it.each([
    [undefined, '102'],
    [null, '102'],
    [1, '102'],
    [2, '102'],
    // MEI apura pelo DAS: CSOSN, como os demais optantes do Simples.
    [4, '102'],
  ])('emitCrt %p (Simples) usa CSOSN %s', (emitCrt, esperado) => {
    expect(defaultsCadastroFiscal(emitCrt).icmsCst).toBe(esperado);
  });

  /**
   * CSOSN em emissor CRT 3 faz o cálculo de imposto recusar a emissão; o
   * produto nascia bloqueado.
   */
  it('emitCrt 3 (Regime Normal) usa CST 00, não CSOSN', () => {
    expect(defaultsCadastroFiscal(3).icmsCst).toBe('00');
  });

  it('PIS e COFINS ficam em 99 nos dois regimes (não exigem alíquota)', () => {
    for (const crt of [1, 3]) {
      const defaults = defaultsCadastroFiscal(crt);
      expect(defaults.pisCst).toBe('99');
      expect(defaults.cofinsCst).toBe('99');
    }
  });

  it('demais campos não dependem do regime', () => {
    expect(defaultsCadastroFiscal(1)).toMatchObject({
      cfopOutState: '6101',
      commercialUnit: 'UN',
      icmsOrigin: '0',
    });
    expect(defaultsCadastroFiscal(3)).toMatchObject({
      cfopOutState: '6101',
      commercialUnit: 'UN',
      icmsOrigin: '0',
    });
  });

  it('isRegimeNormal trata ausência de CRT como Simples', () => {
    expect(isRegimeNormal(undefined)).toBe(false);
    expect(isRegimeNormal(null)).toBe(false);
    expect(isRegimeNormal(2)).toBe(false);
    expect(isRegimeNormal(3)).toBe(true);
    // O 4 é MEI, que apura pelo Simples. A classificação completa tem spec
    // própria em regime-tributario.util.spec.ts.
    expect(isRegimeNormal(4)).toBe(false);
  });
});
