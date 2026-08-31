import {
  montarImpostosNfe,
  type ContextoOperacaoNfe,
  type ItemParaCalculo,
} from './nfe-imposto-payload.util';

const item = (valor: number, extra = {}): ItemParaCalculo => ({
  valores: { valorProdutos: valor },
  tributacao: {
    icmsCst: '00',
    icmsOrigin: '0',
    icmsRate: 18,
    pisCst: '01',
    pisRate: 1.65,
    cofinsCst: '01',
    cofinsRate: 7.6,
    ...extra,
  },
});

const interna: ContextoOperacaoNfe = {
  interestadual: false,
  consumidorFinal: true,
  contribuinte: false,
};

describe('nfe-imposto-payload.util', () => {
  describe('nomes de campo do schema', () => {
    /**
     * O schema usa sufixos: o valor do ICMS próprio é `vICMS_icms`. Enviar
     * `vICMS` faz o provedor ignorar o campo em silêncio.
     */
    it('usa vICMS_icms para o valor do ICMS', () => {
      const { impostos } = montarImpostosNfe([item(1000)], interna);

      expect(impostos[0].ICMS).toEqual({
        orig: 0,
        CST: '00',
        modBC: 3,
        vBC: 1000,
        pICMS: 18,
        vICMS_icms: 180,
      });
      expect(impostos[0].ICMS).not.toHaveProperty('vICMS');
    });

    it('usa os nomes sufixados de PIS e COFINS', () => {
      const { impostos } = montarImpostosNfe([item(1000)], interna);

      expect(impostos[0].PIS).toEqual({
        CST_pis: '01',
        vBC_pis: 1000,
        pPIS: 1.65,
        vPIS: 16.5,
      });
      expect(impostos[0].COFINS).toEqual({
        CST_cofins: '01',
        vBC_cofins: 1000,
        pCOFINS: 7.6,
        vCOFINS: 76,
      });
    });

    /**
     * O IPI exige `cEnq` ao lado e o CST dentro do subgrupo `CSTIPI`. O formato
     * antigo, com `CST_ipi` solto, não corresponde ao layout.
     */
    it('aninha o IPI em CSTIPI e informa o enquadramento', () => {
      const { impostos } = montarImpostosNfe(
        [
          {
            ...item(1000, { ipiCst: '50', ipiRate: 5 }),
            ipiEnquadramento: '101',
          },
        ],
        interna,
      );

      expect(impostos[0].IPI).toEqual({
        cEnq: '101',
        CSTIPI: { CST_IPI: '50', vBC_IPI: 1000, pIPI: 5, vIPI: 50 },
      });
    });

    it('usa 999 como enquadramento padrão do IPI', () => {
      const { impostos } = montarImpostosNfe(
        [item(1000, { ipiCst: '53' })],
        interna,
      );

      expect((impostos[0].IPI as any).cEnq).toBe('999');
    });

    it('omite o grupo de IPI quando o produto não tem CST', () => {
      const { impostos } = montarImpostosNfe([item(1000)], interna);
      expect(impostos[0].IPI).toBeUndefined();
    });
  });

  describe('totalizadores', () => {
    it('soma os itens em vez de zerar', () => {
      const { totais } = montarImpostosNfe([item(1000), item(500)], interna);

      expect(totais.vBC_ttlnfe).toBe('1500.00');
      expect(totais.vICMS_ttlnfe).toBe('270.00');
      expect(totais.vPIS_ttlnfe).toBe('24.75');
      expect(totais.vCOFINS_ttlnfe).toBe('114.00');
    });

    it('não conta item isento na base do ICMS', () => {
      const { totais } = montarImpostosNfe(
        [item(1000), item(500, { icmsCst: '40', icmsRate: null })],
        interna,
      );

      expect(totais.vBC_ttlnfe).toBe('1000.00');
      expect(totais.vICMS_ttlnfe).toBe('180.00');
    });

    it('omite os totais de DIFAL quando ele não incide', () => {
      const { totais } = montarImpostosNfe([item(1000)], interna);

      expect(totais).not.toHaveProperty('vICMSUFDest_ttlnfe');
      expect(totais).not.toHaveProperty('vFCPUFDest_ttlnfe');
    });
  });

  describe('DIFAL', () => {
    const interestadualConsumidor: ContextoOperacaoNfe = {
      interestadual: true,
      consumidorFinal: true,
      contribuinte: false,
      aliquotaInterestadual: 7,
      aliquotaInternaDestino: 20.5,
      aliquotaFcpDestino: 2,
    };

    it('inclui o grupo por item e soma nos totais', () => {
      const { impostos, totais, bloqueios } = montarImpostosNfe(
        [item(1000), item(1000)],
        interestadualConsumidor,
      );

      expect(bloqueios).toEqual([]);
      expect(impostos[0].ICMSUFDest).toMatchObject({
        vBCUFDest: 1000,
        pICMSInter: 7,
        pICMSUFDest: 20.5,
        pICMSInterPart: 100,
        vICMSUFDest: 135,
        vICMSUFRemet: 0,
        vFCPUFDest: 20,
      });
      expect(totais.vICMSUFDest_ttlnfe).toBe('270.00');
      expect(totais.vFCPUFDest_ttlnfe).toBe('40.00');
    });

    it('não inclui o grupo quando o destinatário é contribuinte', () => {
      const { impostos, totais } = montarImpostosNfe([item(1000)], {
        ...interestadualConsumidor,
        contribuinte: true,
      });

      expect(impostos[0].ICMSUFDest).toBeUndefined();
      expect(totais).not.toHaveProperty('vICMSUFDest_ttlnfe');
    });

    it('bloqueia quando falta a alíquota interna do destino', () => {
      const { bloqueios } = montarImpostosNfe([item(1000)], {
        ...interestadualConsumidor,
        aliquotaInternaDestino: null,
      });

      expect(bloqueios[0]).toMatch(/^Item 1: /);
      expect(bloqueios[0]).toMatch(/interna da UF de destino/i);
    });
  });

  describe('bloqueios', () => {
    it('identifica o item que impediu o cálculo', () => {
      const { bloqueios } = montarImpostosNfe(
        [item(1000), item(500, { icmsRate: null })],
        interna,
      );

      expect(bloqueios).toHaveLength(1);
      expect(bloqueios[0]).toMatch(/^Item 2: /);
      expect(bloqueios[0]).toMatch(/alíquota de ICMS/i);
    });

    it('acumula bloqueios de itens diferentes', () => {
      const { bloqueios } = montarImpostosNfe(
        [item(1000, { icmsCst: '10' }), item(500, { icmsRate: null })],
        interna,
      );

      expect(bloqueios).toHaveLength(2);
      expect(bloqueios[0]).toMatch(/^Item 1: /);
      expect(bloqueios[1]).toMatch(/^Item 2: /);
    });
  });
});
