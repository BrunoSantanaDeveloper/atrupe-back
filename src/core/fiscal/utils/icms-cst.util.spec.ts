import {
  CODIGOS_CSOSN,
  CODIGOS_CST,
  codigosCstDeOutroRegime,
  cstIcmsCalculavel,
  exigeAliquotaIcms,
  exigeReducaoBase,
  exigeRegraSt,
  isCsosn,
  opcoesCstIcms,
  validarCstIcmsParaRegime,
} from './icms-cst.util';
import {
  CRT_MEI,
  CRT_REGIME_NORMAL,
  CRT_SIMPLES_EXCESSO_SUBLIMITE,
  CRT_SIMPLES_NACIONAL,
} from './regime-tributario.util';

/**
 * O catálogo decide duas coisas que custam caro quando erram: o que a tela de
 * correção em massa oferece, e o que ela aceita gravar em centenas de produtos
 * de uma vez.
 */
describe('icms-cst.util', () => {
  describe('validarCstIcmsParaRegime', () => {
    it('recusa CSOSN no Regime Normal dizendo o que escolher', () => {
      const check = validarCstIcmsParaRegime('102', CRT_REGIME_NORMAL);

      expect(check.valid).toBe(false);
      expect(check.message).toContain('CSOSN');
      expect(check.message).toContain('00 tributado');
    });

    /**
     * O caminho inverso não passa pelo cálculo — no Simples a nota leva apenas
     * os códigos —, então sem esta recusa o CST ia para o XML e voltava
     * rejeitado pela SEFAZ.
     */
    it('recusa CST do Regime Normal em optante do Simples', () => {
      for (const crt of [
        CRT_SIMPLES_NACIONAL,
        CRT_SIMPLES_EXCESSO_SUBLIMITE,
        CRT_MEI,
      ]) {
        const check = validarCstIcmsParaRegime('00', crt);

        expect(check.valid).toBe(false);
        expect(check.message).toContain('Simples');
      }
    });

    it('aceita CST do Regime Normal em emissor do Regime Normal', () => {
      for (const cst of ['00', '10', '20', '40', '41', '50', '60', '70']) {
        expect(validarCstIcmsParaRegime(cst, CRT_REGIME_NORMAL)).toEqual({
          valid: true,
        });
      }
    });

    it('aceita CSOSN em optante do Simples', () => {
      expect(validarCstIcmsParaRegime('102', CRT_SIMPLES_NACIONAL)).toEqual({
        valid: true,
      });
      expect(validarCstIcmsParaRegime('500', CRT_MEI)).toEqual({
        valid: true,
      });
    });

    /**
     * 51 e 90 são códigos válidos no layout que o cálculo ainda não monta:
     * aplicá-los em massa trocaria um bloqueio de emissão por outro.
     */
    it('recusa CST que o sistema ainda não calcula', () => {
      const diferimento = validarCstIcmsParaRegime('51', CRT_REGIME_NORMAL);
      expect(diferimento.valid).toBe(false);
      expect(diferimento.message).toContain('diferimento');

      const outras = validarCstIcmsParaRegime('90', CRT_REGIME_NORMAL);
      expect(outras.valid).toBe(false);
      expect(outras.message).toContain('não é calculado');
    });

    it('recusa código inexistente nos dois regimes', () => {
      expect(validarCstIcmsParaRegime('99', CRT_REGIME_NORMAL).valid).toBe(
        false,
      );
      expect(validarCstIcmsParaRegime('999', CRT_SIMPLES_NACIONAL).valid).toBe(
        false,
      );
    });

    it('recusa CST vazio', () => {
      expect(validarCstIcmsParaRegime('', CRT_REGIME_NORMAL).valid).toBe(false);
      expect(validarCstIcmsParaRegime('   ', CRT_REGIME_NORMAL).valid).toBe(
        false,
      );
    });

    /** CRT ausente segue tratado como Simples, como no resto do módulo. */
    it('trata emissor sem CRT como Simples', () => {
      expect(validarCstIcmsParaRegime('102', null).valid).toBe(true);
      expect(validarCstIcmsParaRegime('00', null).valid).toBe(false);
    });
  });

  describe('opcoesCstIcms', () => {
    it('no Regime Normal oferece só os CST que o sistema calcula', () => {
      const codigos = opcoesCstIcms(CRT_REGIME_NORMAL).map((o) => o.code);

      expect(codigos).toEqual(
        expect.arrayContaining([
          '00',
          '10',
          '20',
          '30',
          '40',
          '41',
          '50',
          '60',
          '70',
        ]),
      );
      expect(codigos).not.toContain('51');
      expect(codigos).not.toContain('90');
      expect(codigos).not.toContain('102');
    });

    it('no Simples oferece os CSOSN', () => {
      const codigos = opcoesCstIcms(CRT_SIMPLES_NACIONAL).map((o) => o.code);

      expect(codigos).toEqual([...CODIGOS_CSOSN]);
      expect(codigos).not.toContain('00');
    });

    it('marca quais códigos exigem alíquota e redução de base', () => {
      const porCodigo = new Map(
        opcoesCstIcms(CRT_REGIME_NORMAL).map((o) => [o.code, o]),
      );

      expect(porCodigo.get('00')).toMatchObject({
        exigeAliquota: true,
        exigeReducao: false,
        exigeRegraSt: false,
      });
      expect(porCodigo.get('20')).toMatchObject({
        exigeAliquota: true,
        exigeReducao: true,
        exigeRegraSt: false,
      });

      // 10, 30 e 70 dependem de MVA e alíquota do destino, que vêm da regra de
      // ST de cada produto e não de uma correção em massa.
      expect(porCodigo.get('10')).toMatchObject({ exigeRegraSt: true });
      expect(porCodigo.get('70')).toMatchObject({ exigeRegraSt: true });
      expect(porCodigo.get('40')).toMatchObject({
        exigeAliquota: false,
        exigeReducao: false,
      });
    });

    it('rotula com código e descrição, para a tela não ter uma segunda tabela', () => {
      const tributadaIntegralmente = opcoesCstIcms(CRT_REGIME_NORMAL).find(
        (o) => o.code === '00',
      );

      expect(tributadaIntegralmente?.label).toBe(
        '00 - Tributada integralmente',
      );
    });
  });

  describe('codigosCstDeOutroRegime', () => {
    it('no Regime Normal aponta os CSOSN', () => {
      expect(codigosCstDeOutroRegime(CRT_REGIME_NORMAL)).toEqual(CODIGOS_CSOSN);
    });

    it('no Simples aponta os CST', () => {
      expect(codigosCstDeOutroRegime(CRT_SIMPLES_NACIONAL)).toEqual(
        CODIGOS_CST,
      );
      expect(codigosCstDeOutroRegime(CRT_MEI)).toEqual(CODIGOS_CST);
    });

    /** Os dois conjuntos não podem se sobrepor, ou o filtro pegaria a si mesmo. */
    it('não tem código em comum entre os regimes', () => {
      const normal = new Set(CODIGOS_CST);
      expect(CODIGOS_CSOSN.filter((c) => normal.has(c))).toEqual([]);
    });
  });

  describe('classificadores', () => {
    it('isCsosn reconhece os códigos do Simples e tolera espaços', () => {
      expect(isCsosn('102')).toBe(true);
      expect(isCsosn(' 500 ')).toBe(true);
      expect(isCsosn('00')).toBe(false);
      expect(isCsosn(null)).toBe(false);
    });

    it('exigeAliquotaIcms cobre os CST que destacam ICMS próprio', () => {
      expect(['00', '10', '20', '70'].every(exigeAliquotaIcms)).toBe(true);
      expect(['40', '41', '50', '60', '30'].some(exigeAliquotaIcms)).toBe(
        false,
      );
    });

    it('exigeReducaoBase cobre os CST que reduzem a base', () => {
      expect(exigeReducaoBase('20')).toBe(true);
      expect(exigeReducaoBase('70')).toBe(true);
      expect(exigeReducaoBase('00')).toBe(false);
    });

    it('exigeRegraSt aponta os CST com substituição tributária', () => {
      expect(['10', '30', '70'].every(exigeRegraSt)).toBe(true);
      expect(['00', '20', '40', '60'].some(exigeRegraSt)).toBe(false);
    });

    it('cstIcmsCalculavel exclui o que o cálculo não monta', () => {
      expect(cstIcmsCalculavel('00')).toBe(true);
      expect(cstIcmsCalculavel('51')).toBe(false);
      expect(cstIcmsCalculavel('90')).toBe(false);
      expect(cstIcmsCalculavel('102')).toBe(false);
    });
  });
});
