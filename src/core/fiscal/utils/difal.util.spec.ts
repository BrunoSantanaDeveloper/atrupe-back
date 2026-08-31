import { calcularDifal, incideDifal } from './difal.util';

describe('difal.util', () => {
  describe('incideDifal', () => {
    it('incide na venda interestadual a consumidor final não contribuinte', () => {
      expect(
        incideDifal({
          interestadual: true,
          consumidorFinal: true,
          contribuinte: false,
        }),
      ).toBe(true);
    });

    it.each([
      [
        'operação interna',
        { interestadual: false, consumidorFinal: true, contribuinte: false },
      ],
      [
        'revenda, não consumidor final',
        { interestadual: true, consumidorFinal: false, contribuinte: false },
      ],
      [
        'destinatário contribuinte',
        { interestadual: true, consumidorFinal: true, contribuinte: true },
      ],
    ])('não incide em %s', (_caso, ctx) => {
      expect(incideDifal(ctx as any)).toBe(false);
    });
  });

  describe('calcularDifal', () => {
    /**
     * Caso típico: venda de SP para BA, 7% interestadual e 20,5% interna.
     * 1000 x (20,5 - 7) / 100 = 135,00
     */
    it('calcula pela diferença entre a interna e a interestadual', () => {
      const { difal, bloqueios } = calcularDifal({
        base: 1000,
        aliquotaInterestadual: 7,
        aliquotaInternaDestino: 20.5,
      });

      expect(bloqueios).toEqual([]);
      expect(difal).toEqual({
        vBCUFDest: 1000,
        pICMSInter: 7,
        pICMSUFDest: 20.5,
        pICMSInterPart: 100,
        vICMSUFDest: 135,
        vICMSUFRemet: 0,
      });
    });

    /** Desde 2019 a partilha é integral para o destino. */
    it('destina o valor integralmente à UF de destino', () => {
      const { difal } = calcularDifal({
        base: 500,
        aliquotaInterestadual: 12,
        aliquotaInternaDestino: 18,
      });

      expect(difal?.pICMSInterPart).toBe(100);
      expect(difal?.vICMSUFRemet).toBe(0);
    });

    it('aplica a redução de base concedida pelo destino', () => {
      const { difal } = calcularDifal({
        base: 1000,
        aliquotaInterestadual: 7,
        aliquotaInternaDestino: 18,
        reducaoBaseDestino: 50,
      });

      expect(difal?.vBCUFDest).toBe(500);
      expect(difal?.vICMSUFDest).toBe(55);
    });

    /** O FCP não entra na diferença: incide sobre a base e soma por fora. */
    it('calcula o FCP separado da diferença de alíquotas', () => {
      const { difal } = calcularDifal({
        base: 1000,
        aliquotaInterestadual: 7,
        aliquotaInternaDestino: 18,
        aliquotaFcpDestino: 2,
      });

      expect(difal?.vICMSUFDest).toBe(110);
      expect(difal?.vBCFCPUFDest).toBe(1000);
      expect(difal?.pFCPUFDest).toBe(2);
      expect(difal?.vFCPUFDest).toBe(20);
    });

    it('omite o grupo de FCP quando a alíquota é zero ou ausente', () => {
      const semFcp = calcularDifal({
        base: 1000,
        aliquotaInterestadual: 7,
        aliquotaInternaDestino: 18,
      }).difal;
      const fcpZero = calcularDifal({
        base: 1000,
        aliquotaInterestadual: 7,
        aliquotaInternaDestino: 18,
        aliquotaFcpDestino: 0,
      }).difal;

      expect(semFcp).not.toHaveProperty('vFCPUFDest');
      expect(fcpZero).not.toHaveProperty('vFCPUFDest');
    });

    it('bloqueia quando a alíquota interna do destino não está cadastrada', () => {
      const { difal, bloqueios } = calcularDifal({
        base: 1000,
        aliquotaInterestadual: 7,
        aliquotaInternaDestino: null as any,
      });

      expect(difal).toBeNull();
      expect(bloqueios[0]).toMatch(/interna da UF de destino/i);
    });

    /**
     * Diferencial negativo não é imposto a recolher — é sinal de alíquota
     * interna cadastrada errada, e emitir assim geraria valor inválido.
     */
    it('bloqueia quando a interna é menor que a interestadual', () => {
      const { difal, bloqueios } = calcularDifal({
        base: 1000,
        aliquotaInterestadual: 12,
        aliquotaInternaDestino: 7,
      });

      expect(difal).toBeNull();
      expect(bloqueios[0]).toMatch(/ficaria negativo/i);
    });

    it('aceita interna igual à interestadual, sem diferencial', () => {
      const { difal, bloqueios } = calcularDifal({
        base: 1000,
        aliquotaInterestadual: 12,
        aliquotaInternaDestino: 12,
      });

      expect(bloqueios).toEqual([]);
      expect(difal?.vICMSUFDest).toBe(0);
    });

    it('bloqueia redução de base fora de 0 a 100', () => {
      const { difal, bloqueios } = calcularDifal({
        base: 1000,
        aliquotaInterestadual: 7,
        aliquotaInternaDestino: 18,
        reducaoBaseDestino: 150,
      });

      expect(difal).toBeNull();
      expect(bloqueios[0]).toMatch(/entre 0 e 100/i);
    });
  });
});
