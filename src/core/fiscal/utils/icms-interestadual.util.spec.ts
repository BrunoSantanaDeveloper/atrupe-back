import {
  aliquotaInterestadual,
  isOperacaoInterestadual,
} from './icms-interestadual.util';

describe('icms-interestadual.util', () => {
  describe('isOperacaoInterestadual', () => {
    it('reconhece operação entre UFs diferentes', () => {
      expect(isOperacaoInterestadual('ES', 'SP')).toBe(true);
      expect(isOperacaoInterestadual('es', 'SP')).toBe(true);
    });

    it('não é interestadual dentro da mesma UF nem sem UF', () => {
      expect(isOperacaoInterestadual('SP', 'SP')).toBe(false);
      expect(isOperacaoInterestadual('SP', null)).toBe(false);
      expect(isOperacaoInterestadual(undefined, 'SP')).toBe(false);
    });
  });

  describe('aliquotaInterestadual', () => {
    it('devolve null quando não é interestadual', () => {
      expect(aliquotaInterestadual('SP', 'SP', '0')).toBeNull();
      expect(aliquotaInterestadual('SP', '', '0')).toBeNull();
    });

    it('aplica 7% de Sul/Sudeste para Norte, Nordeste e Centro-Oeste', () => {
      expect(aliquotaInterestadual('SP', 'BA', '0')).toBe(7); // Sudeste → Nordeste
      expect(aliquotaInterestadual('RS', 'AM', '0')).toBe(7); // Sul → Norte
      expect(aliquotaInterestadual('MG', 'GO', '0')).toBe(7); // Sudeste → Centro-Oeste
    });

    it('aplica 7% para o Espírito Santo, que é destino favorecido', () => {
      expect(aliquotaInterestadual('SP', 'ES', '0')).toBe(7);
    });

    /**
     * O ES pertence ao Sudeste como origem, então sai com 7% para as regiões
     * favorecidas — mas volta a 12% quando o destino é Sul ou Sudeste.
     */
    it('trata o Espírito Santo como origem do Sudeste', () => {
      expect(aliquotaInterestadual('ES', 'GO', '0')).toBe(7);
      expect(aliquotaInterestadual('ES', 'SP', '0')).toBe(12);
    });

    it('aplica 12% nos demais sentidos', () => {
      expect(aliquotaInterestadual('BA', 'SP', '0')).toBe(12); // Nordeste → Sudeste
      expect(aliquotaInterestadual('SP', 'RJ', '0')).toBe(12); // dentro do Sudeste
      expect(aliquotaInterestadual('GO', 'MT', '0')).toBe(12); // Centro-Oeste → Centro-Oeste
    });

    it.each(['1', '2', '3', '8'])(
      'aplica 4% para mercadoria importada de origem %s',
      (origem) => {
        expect(aliquotaInterestadual('SP', 'BA', origem)).toBe(4);
        expect(aliquotaInterestadual('BA', 'SP', origem)).toBe(4);
      },
    );

    /**
     * Origem 4 (processo produtivo básico) e 6/7 (importada sem similar
     * nacional) estão fora da Resolução 13/2012 e mantêm 7% ou 12%.
     */
    it.each(['0', '4', '5', '6', '7'])(
      'mantém a regra por região para a origem %s',
      (origem) => {
        expect(aliquotaInterestadual('SP', 'BA', origem)).toBe(7);
        expect(aliquotaInterestadual('BA', 'SP', origem)).toBe(12);
      },
    );

    it('ignora origem ausente e cai na regra por região', () => {
      expect(aliquotaInterestadual('SP', 'BA', null)).toBe(7);
      expect(aliquotaInterestadual('SP', 'BA', undefined)).toBe(7);
    });
  });
});
