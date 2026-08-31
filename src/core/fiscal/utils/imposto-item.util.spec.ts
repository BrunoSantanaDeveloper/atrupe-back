import {
  calcularBaseOperacao,
  calcularImpostoItem,
  type TributacaoItem,
} from './imposto-item.util';

/** Item tributado integralmente, o caso mais comum do Regime Normal. */
const tributado: TributacaoItem = {
  icmsCst: '00',
  icmsOrigin: '0',
  icmsRate: 18,
  pisCst: '01',
  pisRate: 1.65,
  cofinsCst: '01',
  cofinsRate: 7.6,
};

describe('imposto-item.util', () => {
  describe('calcularBaseOperacao', () => {
    it('soma acessórias e desconta o incondicional', () => {
      expect(
        calcularBaseOperacao({
          valorProdutos: 1000,
          frete: 100,
          seguro: 50,
          outrasDespesas: 25,
          desconto: 75,
        }),
      ).toBe(1100);
    });

    it('ignora campos ausentes', () => {
      expect(calcularBaseOperacao({ valorProdutos: 250 })).toBe(250);
    });

    /** Desconto maior que a operação não vira base negativa. */
    it('não devolve base negativa', () => {
      expect(calcularBaseOperacao({ valorProdutos: 100, desconto: 250 })).toBe(
        0,
      );
    });
  });

  describe('ICMS', () => {
    it('calcula o CST 00 sobre a base da operação', () => {
      const r = calcularImpostoItem({ valorProdutos: 1000 }, tributado);

      expect(r.bloqueios).toEqual([]);
      expect(r.icms).toEqual({
        orig: 0,
        CST: '00',
        modBC: 3,
        vBC: 1000,
        pICMS: 18,
        vICMS: 180,
      });
    });

    it('aplica a redução de base no CST 20', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, icmsCst: '20', icmsReducao: 33.33 },
      );

      expect(r.bloqueios).toEqual([]);
      expect(r.icms.pRedBC).toBe(33.33);
      expect(r.icms.vBC).toBe(666.7);
      expect(r.icms.vICMS).toBe(120.01);
    });

    it.each(['40', '41', '50'])('não destaca valor no CST %s', (cst) => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, icmsCst: cst, icmsRate: null },
      );

      expect(r.bloqueios).toEqual([]);
      expect(r.icms).toEqual({ orig: 0, CST: cst });
    });

    it('preserva a origem da mercadoria', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 100 },
        { ...tributado, icmsOrigin: '1' },
      );
      expect(r.icms.orig).toBe(1);
    });
  });

  /**
   * O ponto central do módulo: em vez de emitir com imposto zerado, o cálculo
   * devolve o impedimento para que a emissão seja barrada.
   */
  describe('bloqueios', () => {
    it('bloqueia quando o CST 00 não tem alíquota cadastrada', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, icmsRate: null },
      );

      expect(r.bloqueios).toHaveLength(1);
      expect(r.bloqueios[0]).toMatch(/alíquota de ICMS/i);
      expect(r.icms.vICMS).toBeUndefined();
      expect(r.icms.vBC).toBeUndefined();
    });

    it('bloqueia o CST 20 sem percentual de redução', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, icmsCst: '20', icmsReducao: null },
      );

      expect(r.bloqueios[0]).toMatch(/redução da base/i);
      expect(r.icms.vICMS).toBeUndefined();
    });

    it.each([
      ['10', /substituição tributária/i],
      ['60', /substituição tributária/i],
      ['70', /redução de base com substituição/i],
      ['51', /diferimento/i],
    ])('bloqueia o CST %s, ainda não implementado', (cst, motivo) => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, icmsCst: cst },
      );

      expect(r.bloqueios[0]).toMatch(motivo);
      expect(r.icms.vICMS).toBeUndefined();
    });

    it('bloqueia CST desconhecido em vez de ignorá-lo', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, icmsCst: '77' },
      );
      expect(r.bloqueios[0]).toMatch(/não é reconhecido/i);
    });

    it('bloqueia quando falta CST no cadastro', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, icmsCst: '' },
      );
      expect(r.bloqueios[0]).toMatch(/CST do ICMS não informado/i);
    });

    it('acumula bloqueios de tributos diferentes', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { icmsCst: '00', icmsRate: null, pisCst: '01', cofinsCst: '01' },
      );

      expect(r.bloqueios).toHaveLength(3);
      expect(r.bloqueios.join(' ')).toMatch(/ICMS/);
      expect(r.bloqueios.join(' ')).toMatch(/PIS/);
      expect(r.bloqueios.join(' ')).toMatch(/COFINS/);
    });
  });

  describe('PIS e COFINS', () => {
    it('calcula pelas alíquotas do não cumulativo', () => {
      const r = calcularImpostoItem({ valorProdutos: 1000 }, tributado);

      expect(r.pis).toEqual({
        CST: '01',
        vBC: 1000,
        aliquota: 1.65,
        valor: 16.5,
      });
      expect(r.cofins).toEqual({
        CST: '01',
        vBC: 1000,
        aliquota: 7.6,
        valor: 76,
      });
    });

    it('calcula pelas alíquotas do cumulativo', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, pisRate: 0.65, cofinsRate: 3 },
      );

      expect(r.pis.valor).toBe(6.5);
      expect(r.cofins.valor).toBe(30);
    });

    /** CST 07 (alíquota zero) e 49 (outras) não destacam valor nem bloqueiam. */
    it.each(['04', '06', '07', '08', '49', '99'])(
      'não destaca valor no CST %s',
      (cst) => {
        const r = calcularImpostoItem(
          { valorProdutos: 1000 },
          {
            ...tributado,
            pisCst: cst,
            cofinsCst: cst,
            pisRate: null,
            cofinsRate: null,
          },
        );

        expect(r.bloqueios).toEqual([]);
        expect(r.pis).toEqual({ CST: cst });
        expect(r.cofins).toEqual({ CST: cst });
      },
    );
  });

  describe('IPI', () => {
    it('é omitido quando o produto não tem CST de IPI', () => {
      expect(
        calcularImpostoItem({ valorProdutos: 100 }, tributado).ipi,
      ).toBeUndefined();
    });

    it('calcula a saída tributada (CST 50)', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, ipiCst: '50', ipiRate: 5 },
      );

      expect(r.ipi).toEqual({ CST: '50', vBC: 1000, aliquota: 5, valor: 50 });
    });

    it('não destaca valor nos CSTs não tributados', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, ipiCst: '53' },
      );

      expect(r.bloqueios).toEqual([]);
      expect(r.ipi).toEqual({ CST: '53' });
    });

    it('bloqueia saída tributada sem alíquota', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, ipiCst: '50', ipiRate: null },
      );

      expect(r.bloqueios[0]).toMatch(/IPI exige alíquota/i);
      expect(r.ipi?.valor).toBeUndefined();
    });
  });

  describe('arredondamento', () => {
    it('fecha os centavos sem resíduo de ponto flutuante', () => {
      const r = calcularImpostoItem({ valorProdutos: 10.1 }, tributado);

      expect(r.icms.vICMS).toBe(1.82);
      expect(r.pis.valor).toBe(0.17);
      expect(r.cofins.valor).toBe(0.77);
    });
  });
});
