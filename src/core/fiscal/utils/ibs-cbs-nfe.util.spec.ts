import {
  aliquotasReformaTributaria,
  calcularVNFIBScbsIS,
  montarIbsCbsItem,
  montarIbsCbsTotais,
} from './ibs-cbs-nfe.util';

/** Fase de teste de 2026: 0,1% de IBS estadual e 0,9% de CBS. */
const aliquotas = { ibsUf: 0.1, ibsMun: 0, cbs: 0.9 };

describe('ibs-cbs-nfe.util', () => {
  /**
   * Referência: `Exemplos JSON/NFe/Envio_NFe_CST_000` do provedor. Item de
   * R$ 10,00 com CST 000 e cClassTrib 000001 produz exatamente este grupo.
   */
  describe('exemplo oficial CST 000', () => {
    it('reproduz o grupo do exemplo do provedor', () => {
      const { grupo, bloqueios } = montarIbsCbsItem({
        base: 10,
        cst: '000',
        cClassTrib: '000001',
        aliquotas,
      });

      expect(bloqueios).toEqual([]);
      expect(grupo).toEqual({
        CST: '000',
        cClassTrib: '000001',
        gIBSCBS: {
          vBC: 10,
          gIBSUF: { pIBSUF: 0.1, vIBSUF: 0.01 },
          gIBSMun: { pIBSMun: 0, vIBSMun: 0 },
          vIBS: 0.01,
          gCBS: { pCBS: 0.9, vCBS: 0.09 },
        },
      });
    });

    it('reproduz o totalizador do exemplo do provedor', () => {
      const { valores } = montarIbsCbsItem({
        base: 10,
        cst: '000',
        cClassTrib: '000001',
        aliquotas,
      });

      expect(montarIbsCbsTotais([valores!])).toEqual({
        vBCIBSCBS: 10,
        gIBS: {
          gIBSUF: { vDif: 0, vDevTrib: 0, vIBSUF: 0.01 },
          gIBSMun: { vDif: 0, vDevTrib: 0, vIBSMun: 0 },
          vIBS: 0.01,
          vCredPres: 0,
          vCredPresCondSus: 0,
        },
        gCBS: {
          vDif: 0,
          vDevTrib: 0,
          vCBS: 0.09,
          vCredPres: 0,
          vCredPresCondSus: 0,
        },
      });
    });
  });

  /**
   * Referência: `Envio_NFe_CST_410`. Imunidade/não incidência sai só com os
   * códigos — o grupo de valores é omitido, apesar de o XSD marcá-lo como
   * obrigatório.
   */
  it('envia só os códigos no CST 410 (imunidade)', () => {
    const { grupo, valores, bloqueios } = montarIbsCbsItem({
      base: 450,
      cst: '410',
      cClassTrib: '410008',
      aliquotas,
    });

    expect(bloqueios).toEqual([]);
    expect(grupo).toEqual({ CST: '410', cClassTrib: '410008' });
    expect(grupo).not.toHaveProperty('gIBSCBS');
    // Sem valores, nada entra no totalizador da nota.
    expect(valores).toBeUndefined();
  });

  describe('bloqueios', () => {
    it('exige o CST', () => {
      const { grupo, bloqueios } = montarIbsCbsItem({
        base: 100,
        cClassTrib: '000001',
        aliquotas,
      });

      expect(grupo).toBeUndefined();
      expect(bloqueios[0]).toMatch(/CST do IBS\/CBS não informado/i);
    });

    it('exige o cClassTrib', () => {
      const { bloqueios } = montarIbsCbsItem({
        base: 100,
        cst: '000',
        aliquotas,
      });

      expect(bloqueios[0]).toMatch(/cClassTrib/i);
    });

    it('bloqueia CST fora da tabela nacional', () => {
      const { grupo, bloqueios } = montarIbsCbsItem({
        base: 100,
        cst: '999',
        cClassTrib: '999999',
        aliquotas,
      });

      expect(grupo).toBeUndefined();
      expect(bloqueios[0]).toMatch(/não consta na tabela nacional/i);
    });

    /**
     * Monofásica declara os valores em `gIBSCBSMono`. Emitir o grupo padrão
     * seria declaração no lugar errado, então bloqueia nomeando o grupo.
     */
    it('bloqueia CST cujos valores vão em grupo próprio', () => {
      const { grupo, bloqueios } = montarIbsCbsItem({
        base: 100,
        cst: '620',
        cClassTrib: '620001',
        aliquotas,
      });

      expect(grupo).toBeUndefined();
      expect(bloqueios[0]).toMatch(/gIBSCBSMono/);
    });
  });

  describe('totalizador', () => {
    it('soma os itens', () => {
      const item = (base: number) =>
        montarIbsCbsItem({
          base,
          cst: '000',
          cClassTrib: '000001',
          aliquotas,
        }).valores!;

      const totais = montarIbsCbsTotais([item(1000), item(500)]);

      expect(totais.vBCIBSCBS).toBe(1500);
      expect(totais.gIBS.vIBS).toBe(1.5);
      expect(totais.gCBS.vCBS).toBe(13.5);
    });

    it('devolve zeros quando nenhum item tem valores', () => {
      const totais = montarIbsCbsTotais([]);

      expect(totais.vBCIBSCBS).toBe(0);
      expect(totais.gIBS.vIBS).toBe(0);
      expect(totais.gCBS.vCBS).toBe(0);
    });
  });

  /**
   * O campo carrega o total COM os novos tributos: vNF continua sem eles
   * porque a regra nacional proíbe somá-los em 2025 e 2026.
   */
  it('soma IBS e CBS ao valor da nota em vNFIBScbsIS', () => {
    const { valores } = montarIbsCbsItem({
      base: 10,
      cst: '000',
      cClassTrib: '000001',
      aliquotas,
    });
    const totais = montarIbsCbsTotais([valores!]);

    expect(calcularVNFIBScbsIS(10, totais)).toBe(10.1);
  });

  describe('ativação', () => {
    it('não devolve alíquotas com a Reforma desligada', () => {
      expect(
        aliquotasReformaTributaria({ reformaTributariaAtiva: false }).aliquotas,
      ).toBeNull();
    });

    it('usa o padrão nacional quando o emissor não sobrescreve', () => {
      expect(
        aliquotasReformaTributaria({ reformaTributariaAtiva: true }).aliquotas,
      ).toEqual({ ibsUf: 0.1, ibsMun: 0, cbs: 0.9 });
    });

    /** A parcela municipal do IBS é definida por cada município. */
    it('deixa o emissor sobrescrever a alíquota municipal', () => {
      const { aliquotas: resolvidas } = aliquotasReformaTributaria({
        reformaTributariaAtiva: true,
        aliquotaIbsMun: 0.05,
      });

      expect(resolvidas).toEqual({ ibsUf: 0.1, ibsMun: 0.05, cbs: 0.9 });
    });

    /**
     * A partir de 2027 as alíquotas mudam por lei e ainda não estão
     * confirmadas. Quem chama tem de barrar a emissão: seguir com as de teste
     * subdeclararia a nota em duas ordens de grandeza.
     */
    it('sinaliza fase não coberta fora do período com alíquotas confirmadas', () => {
      jest.useFakeTimers().setSystemTime(new Date('2027-03-01T12:00:00Z'));
      try {
        const { aliquotas, faseCoberta } = aliquotasReformaTributaria({
          reformaTributariaAtiva: true,
        });

        expect(aliquotas).not.toBeNull();
        expect(faseCoberta).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('marca a fase como coberta em 2026', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-31T12:00:00Z'));
      try {
        expect(
          aliquotasReformaTributaria({ reformaTributariaAtiva: true })
            .faseCoberta,
        ).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    /** Zero é alíquota legítima e não pode cair no padrão. */
    it('respeita alíquota zero configurada', () => {
      const { aliquotas: resolvidas } = aliquotasReformaTributaria({
        reformaTributariaAtiva: true,
        aliquotaCbs: 0,
      });

      expect(resolvidas?.cbs).toBe(0);
    });
  });
});
