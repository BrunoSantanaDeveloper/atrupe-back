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
      ['51', /diferimento/i],
      ['90', /outras/i],
    ])('bloqueia o CST %s, ainda não implementado', (cst, motivo) => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, icmsCst: cst },
      );

      expect(r.bloqueios[0]).toMatch(motivo);
      expect(r.icms.vICMS).toBeUndefined();
    });

    it.each(['10', '70'])(
      'bloqueia o CST %s sem MVA cadastrada para o destino',
      (cst) => {
        const r = calcularImpostoItem(
          { valorProdutos: 1000 },
          { ...tributado, icmsCst: cst, icmsReducao: 20 },
        );

        expect(r.bloqueios.join(' ')).toMatch(/MVA/i);
        expect(r.icms.st).toBeUndefined();
      },
    );

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

  describe('substituição tributária', () => {
    const comSt = {
      ...tributado,
      icmsCst: '10',
      stMva: 40,
      stAliquota: 18,
    };

    it('destaca ICMS próprio e ST no CST 10', () => {
      const r = calcularImpostoItem({ valorProdutos: 1000 }, comSt);

      expect(r.bloqueios).toEqual([]);
      expect(r.icms.vICMS).toBe(180);
      expect(r.icms.st).toMatchObject({
        modBCST: 4,
        pMVAST: 40,
        vBCST: 1400,
        pICMSST: 18,
        vICMSST: 72, // 1400 x 18% - 180
      });
    });

    /** CST 30 é isento no próprio, mas retém por substituição. */
    it('retém sem ICMS próprio no CST 30', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...comSt, icmsCst: '30' },
      );

      expect(r.bloqueios).toEqual([]);
      expect(r.icms.vICMS).toBeUndefined();
      expect(r.icms.st?.vICMSST).toBe(252);
    });

    it('combina redução de base e ST no CST 70', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...comSt, icmsCst: '70', icmsReducao: 50 },
      );

      expect(r.bloqueios).toEqual([]);
      expect(r.icms.pRedBC).toBe(50);
      expect(r.icms.vBC).toBe(500);
      expect(r.icms.vICMS).toBe(90);
      expect(r.icms.st?.vBCST).toBe(1400);
    });

    /**
     * CST 60 significa imposto já retido antes: os valores vêm do documento de
     * origem, não de cálculo nosso, e os campos são opcionais no layout.
     */
    it('não destaca nem bloqueia no CST 60', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...tributado, icmsCst: '60' },
      );

      expect(r.bloqueios).toEqual([]);
      expect(r.icms).toEqual({ orig: 0, CST: '60' });
    });

    it('inclui o IPI na base da ST', () => {
      const r = calcularImpostoItem(
        { valorProdutos: 1000 },
        { ...comSt, ipiCst: '50', ipiRate: 10 },
      );

      expect(r.ipi?.valor).toBe(100);
      expect(r.icms.st?.vBCST).toBe(1540); // (1000 + 100) x 1,40
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
  /**
   * Todo produto ja' cadastrado usa CSOSN (padrao 102), porque o sistema
   * nasceu atendendo so' o Simples. Ao migrar para o Regime Normal todos
   * bloqueiam de uma vez — a mensagem precisa dizer o que fazer.
   */
  describe('CSOSN no Regime Normal', () => {
    it('explica que o codigo e do Simples e indica a saida', () => {
      const { bloqueios } = calcularImpostoItem(
        { valorProdutos: 1000 },
        {
          icmsCst: '102',
          pisCst: '01',
          pisRate: 1.65,
          cofinsCst: '01',
          cofinsRate: 7.6,
        },
      );

      expect(bloqueios[0]).toMatch(/CSOSN/);
      expect(bloqueios[0]).toMatch(/Simples Nacional/);
      expect(bloqueios[0]).toMatch(/Regime Normal/);
    });

    it('vale para os demais CSOSN, nao so o padrao do cadastro', () => {
      for (const cst of ['101', '201', '500', '900']) {
        const { bloqueios } = calcularImpostoItem(
          { valorProdutos: 100 },
          { icmsCst: cst, pisCst: '07', cofinsCst: '07' },
        );
        expect(bloqueios[0]).toMatch(/CSOSN/);
      }
    });

    /** CST desconhecido que nao e' CSOSN mantem a mensagem generica. */
    it('nao confunde codigo invalido qualquer com CSOSN', () => {
      const { bloqueios } = calcularImpostoItem(
        { valorProdutos: 100 },
        { icmsCst: '77', pisCst: '07', cofinsCst: '07' },
      );

      expect(bloqueios[0]).toMatch(/não é reconhecido/);
      expect(bloqueios[0]).not.toMatch(/CSOSN/);
    });
  });
});
