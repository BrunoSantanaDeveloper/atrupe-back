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
  /**
   * `vNF` soma os tributos cobrados do destinatário por fora da mercadoria —
   * ST, FCP retido por ST e IPI (tag W16). O total da nota era fechado sem
   * eles: enquanto só o Simples emitia, eram sempre zero; no Regime Normal, a
   * primeira nota com ST ou IPI sairia com vNF menor que a soma dos itens.
   */
  describe('acréscimos que entram em vNF', () => {
    it('é zero quando só há ICMS próprio', () => {
      const { acrescimosNoTotal } = montarImpostosNfe([item(1000)], interna);

      expect(acrescimosNoTotal).toBe(0);
    });

    it('soma o IPI destacado', () => {
      const { acrescimosNoTotal, totais } = montarImpostosNfe(
        [item(1000, { ipiCst: '50', ipiRate: 10 })],
        interna,
      );

      expect(totais.vIPI_ttlnfe).toBe('100.00');
      expect(acrescimosNoTotal).toBe(100);
    });

    it('soma o ICMS-ST e o FCP-ST', () => {
      const { acrescimosNoTotal, totais } = montarImpostosNfe(
        [
          item(1000, {
            icmsCst: '10',
            stMva: 40,
            stAliquota: 18,
            stFcpRate: 2,
          }),
        ],
        interna,
      );

      const esperado =
        Number(totais.vST_ttlnfe) + Number(totais.vFCPST_ttlnfe ?? '0');
      expect(esperado).toBeGreaterThan(0);
      expect(acrescimosNoTotal).toBe(esperado);
    });

    /** O FCP do ICMS próprio já está dentro do preço: não entra em vNF. */
    it('não soma o FCP do ICMS próprio', () => {
      const { acrescimosNoTotal, totais } = montarImpostosNfe(
        [item(1000, { fcpRate: 2 })],
        interna,
      );

      expect(totais.vFCP_ttlnfe).toBe('20.00');
      expect(acrescimosNoTotal).toBe(0);
    });

    it('acumula os itens da nota', () => {
      const { acrescimosNoTotal } = montarImpostosNfe(
        [
          item(1000, { ipiCst: '50', ipiRate: 10 }),
          item(500, { ipiCst: '50', ipiRate: 10 }),
        ],
        interna,
      );

      expect(acrescimosNoTotal).toBe(150);
    });
  });

  describe('FCP sobre o ICMS próprio', () => {
    it('envia o grupo de FCP no item e o total da nota', () => {
      const { impostos, totais } = montarImpostosNfe(
        [item(1000, { fcpRate: 2 })],
        interna,
      );

      expect(impostos[0].ICMS).toMatchObject({
        vBC: 1000,
        vICMS_icms: 180,
        vBCFCP: 1000,
        pFCP: 2,
        vFCP: 20,
      });
      expect(totais.vFCP_ttlnfe).toBe('20.00');
    });

    /** Campo ausente e campo zerado dizem coisas diferentes à SEFAZ. */
    it('não envia o total de FCP quando nenhum item tem o fundo', () => {
      const { impostos, totais } = montarImpostosNfe([item(1000)], interna);

      expect(impostos[0].ICMS).not.toHaveProperty('vFCP');
      expect(totais).not.toHaveProperty('vFCP_ttlnfe');
    });
  });

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

  describe('substituição tributária', () => {
    it('mapeia o grupo de ST e soma os totalizadores', () => {
      const { impostos, totais, bloqueios } = montarImpostosNfe(
        [
          item(1000, {
            icmsCst: '10',
            stMva: 40,
            stAliquota: 18,
            stFcpRate: 2,
          }),
        ],
        interna,
      );

      expect(bloqueios).toEqual([]);
      expect(impostos[0].ICMS).toMatchObject({
        CST: '10',
        vICMS_icms: 180,
        modBCST: 4,
        pMVAST: 40,
        vBCST: 1400,
        pICMSST: 18,
        vICMSST_icms: 72,
        vFCPST: 28,
      });
      expect(totais.vBCST_ttlnfe).toBe('1400.00');
      expect(totais.vST_ttlnfe).toBe('72.00');
      expect(totais.vFCPST_ttlnfe).toBe('28.00');
    });

    it('envia o grupo de ST mesmo sem ICMS próprio (CST 30)', () => {
      const { impostos } = montarImpostosNfe(
        [item(1000, { icmsCst: '30', stMva: 40, stAliquota: 18 })],
        interna,
      );

      expect(impostos[0].ICMS).not.toHaveProperty('vICMS_icms');
      expect(impostos[0].ICMS).toMatchObject({
        vBCST: 1400,
        vICMSST_icms: 252,
      });
    });

    it('mantém os totais de ST zerados quando não há substituição', () => {
      const { totais } = montarImpostosNfe([item(1000)], interna);

      expect(totais.vBCST_ttlnfe).toBe('0.00');
      expect(totais.vST_ttlnfe).toBe('0.00');
      expect(totais).not.toHaveProperty('vFCPST_ttlnfe');
    });
  });

  describe('Reforma Tributária', () => {
    const comReforma: ContextoOperacaoNfe = {
      ...interna,
      reformaTributaria: { ibsUf: 0.1, ibsMun: 0, cbs: 0.9 },
    };

    const itemRt = (valor: number) => ({
      ...item(valor),
      cstIbsCbs: '000',
      codClassificacao: '000001',
    });

    /**
     * O grupo só existe no layout paralelo da Reforma no provedor. Sem
     * ativação nada é enviado — e a falta de CST de IBS/CBS no cadastro não
     * pode barrar quem emite hoje.
     */
    it('não envia o grupo nem bloqueia com a Reforma desligada', () => {
      const { impostos, ibsCbsTotais, bloqueios } = montarImpostosNfe(
        [item(1000)],
        interna,
      );

      expect(impostos[0]).not.toHaveProperty('IBSCBS');
      expect(ibsCbsTotais).toBeUndefined();
      expect(bloqueios).toEqual([]);
    });

    it('envia o grupo por item e o totalizador da nota', () => {
      const { impostos, ibsCbsTotais, bloqueios } = montarImpostosNfe(
        [itemRt(1000), itemRt(500)],
        comReforma,
      );

      expect(bloqueios).toEqual([]);
      expect(impostos[0].IBSCBS).toEqual({
        CST: '000',
        cClassTrib: '000001',
        gIBSCBS: {
          vBC: 1000,
          gIBSUF: { pIBSUF: 0.1, vIBSUF: 1 },
          gIBSMun: { pIBSMun: 0, vIBSMun: 0 },
          vIBS: 1,
          gCBS: { pCBS: 0.9, vCBS: 9 },
        },
      });
      expect(ibsCbsTotais?.vBCIBSCBS).toBe(1500);
      expect(ibsCbsTotais?.gCBS.vCBS).toBe(13.5);
    });

    /** A base do IBS/CBS é a mesma base da operação, com desconto aplicado. */
    it('calcula sobre a base do item, não sobre o valor bruto', () => {
      const { impostos } = montarImpostosNfe(
        [
          {
            ...itemRt(1000),
            valores: { valorProdutos: 1000, desconto: 200 },
          },
        ],
        comReforma,
      );

      expect(impostos[0].IBSCBS?.gIBSCBS?.vBC).toBe(800);
    });

    it('atribui o bloqueio ao item que o originou', () => {
      const { bloqueios } = montarImpostosNfe(
        [itemRt(1000), { ...item(500), cstIbsCbs: '000' }],
        comReforma,
      );

      expect(bloqueios).toHaveLength(1);
      expect(bloqueios[0]).toMatch(/^Item 2: /);
      expect(bloqueios[0]).toMatch(/cClassTrib/i);
    });

    it('mantém o totalizador zerado quando nenhum item gera valores', () => {
      const { ibsCbsTotais } = montarImpostosNfe(
        [{ ...item(1000), cstIbsCbs: '410', codClassificacao: '410008' }],
        comReforma,
      );

      expect(ibsCbsTotais?.vBCIBSCBS).toBe(0);
      expect(ibsCbsTotais?.gIBS.vIBS).toBe(0);
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

      // Um item pode gerar mais de um bloqueio; o que importa é que todos
      // fiquem atribuídos ao item que os originou.
      expect(
        bloqueios.filter((b) => b.startsWith('Item 1: ')).length,
      ).toBeGreaterThan(0);
      expect(
        bloqueios.filter((b) => b.startsWith('Item 2: ')).length,
      ).toBeGreaterThan(0);
    });
  });
});
