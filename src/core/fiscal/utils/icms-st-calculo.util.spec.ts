import { calcularIcmsSt } from './icms-st-calculo.util';

describe('icms-st-calculo.util', () => {
  /**
   * Caso de referência: operação de 1.000, MVA 40%, alíquota interna 18% e
   * ICMS próprio de 120 (12% interestadual).
   *   vBCST = 1000 x 1,40 = 1400
   *   vICMSST = 1400 x 18% - 120 = 252 - 120 = 132
   */
  it('calcula a base pela margem e desconta o ICMS próprio', () => {
    const { st, bloqueios } = calcularIcmsSt({
      baseOperacao: 1000,
      mva: 40,
      aliquotaSt: 18,
      icmsProprio: 120,
    });

    expect(bloqueios).toEqual([]);
    expect(st).toEqual({
      modBCST: 4,
      pMVAST: 40,
      vBCST: 1400,
      pICMSST: 18,
      vICMSST: 132,
    });
  });

  /** O IPI integra a base da ST, ao contrário da base do ICMS próprio. */
  it('inclui o IPI na base da substituição', () => {
    const { st } = calcularIcmsSt({
      baseOperacao: 1000,
      valorIpi: 100,
      mva: 40,
      aliquotaSt: 18,
      icmsProprio: 120,
    });

    expect(st?.vBCST).toBe(1540); // (1000 + 100) x 1,40
    expect(st?.vICMSST).toBe(157.2); // 1540 x 18% - 120
  });

  it('aplica a redução da base da ST', () => {
    const { st } = calcularIcmsSt({
      baseOperacao: 1000,
      mva: 40,
      aliquotaSt: 18,
      reducaoBaseSt: 50,
      icmsProprio: 0,
    });

    expect(st?.pRedBCST).toBe(50);
    expect(st?.vBCST).toBe(700); // 1400 x 0,50
    expect(st?.vICMSST).toBe(126);
  });

  /** CST 30 não destaca ICMS próprio: não há o que subtrair. */
  it('retém o valor cheio quando não há ICMS próprio', () => {
    const { st } = calcularIcmsSt({
      baseOperacao: 1000,
      mva: 40,
      aliquotaSt: 18,
    });

    expect(st?.vICMSST).toBe(252);
  });

  /** Retenção negativa não existe e seria rejeitada pela SEFAZ. */
  it('não devolve retenção negativa', () => {
    const { st } = calcularIcmsSt({
      baseOperacao: 1000,
      mva: 0,
      aliquotaSt: 12,
      icmsProprio: 500,
    });

    expect(st?.vICMSST).toBe(0);
  });

  it('calcula o FCP retido sobre a base da ST', () => {
    const { st } = calcularIcmsSt({
      baseOperacao: 1000,
      mva: 40,
      aliquotaSt: 18,
      icmsProprio: 120,
      aliquotaFcpSt: 2,
    });

    expect(st?.vBCFCPST).toBe(1400);
    expect(st?.pFCPST).toBe(2);
    expect(st?.vFCPST).toBe(28);
  });

  it('omite o FCP quando a alíquota é zero ou ausente', () => {
    const semFcp = calcularIcmsSt({
      baseOperacao: 1000,
      mva: 40,
      aliquotaSt: 18,
    }).st;
    const fcpZero = calcularIcmsSt({
      baseOperacao: 1000,
      mva: 40,
      aliquotaSt: 18,
      aliquotaFcpSt: 0,
    }).st;

    expect(semFcp).not.toHaveProperty('vFCPST');
    expect(fcpZero).not.toHaveProperty('vFCPST');
  });

  describe('bloqueios', () => {
    it('bloqueia sem MVA cadastrada', () => {
      const { st, bloqueios } = calcularIcmsSt({
        baseOperacao: 1000,
        mva: null as any,
        aliquotaSt: 18,
      });

      expect(st).toBeNull();
      expect(bloqueios[0]).toMatch(/MVA.*não cadastrada/i);
    });

    it('bloqueia sem alíquota interna do destino', () => {
      const { st, bloqueios } = calcularIcmsSt({
        baseOperacao: 1000,
        mva: 40,
        aliquotaSt: null as any,
      });

      expect(st).toBeNull();
      expect(bloqueios[0]).toMatch(/Alíquota interna/i);
    });

    it('bloqueia redução da base fora de 0 a 100', () => {
      const { st, bloqueios } = calcularIcmsSt({
        baseOperacao: 1000,
        mva: 40,
        aliquotaSt: 18,
        reducaoBaseSt: 100,
      });

      expect(st).toBeNull();
      expect(bloqueios[0]).toMatch(/entre 0 e 100/i);
    });
  });
});
