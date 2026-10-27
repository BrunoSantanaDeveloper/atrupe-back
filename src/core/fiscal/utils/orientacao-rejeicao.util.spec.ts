import {
  MARCADOR_ORIENTACAO,
  mensagemComOrientacao,
  motivoComOrientacao,
  orientacaoRejeicaoFiscal,
} from './orientacao-rejeicao.util';

describe('orientacaoRejeicaoFiscal', () => {
  /**
   * Caso de 23/10/2026: o emissor estava configurado, a nota chegou à SEFAZ e
   * voltou "Emissor nao habilitado para emissao da NF-e/NFC-e". O texto cru
   * não diz que a providência é na SEFAZ, e o usuário achou que o sistema
   * tinha falhado.
   */
  it('203 aponta a habilitação na SEFAZ como providência fora do Atrupe', () => {
    const texto = orientacaoRejeicaoFiscal({
      origem: 'SEFAZ',
      codigo: 203,
      modelo: 'NFC-e',
    });

    expect(texto).toMatch(new RegExp(`^${MARCADOR_ORIENTACAO}`));
    expect(texto).toContain('fora do Atrupe');
    expect(texto).toContain('habilitado para emitir NFC-e');
    expect(texto).toContain('contador');
    // O portal mostrava um CSC "Ativo": a confusão que o texto desfaz.
    expect(texto).toContain('CSC ativo');
  });

  it('203 na NF-e não fala de CSC', () => {
    const texto = orientacaoRejeicaoFiscal({
      origem: 'SEFAZ',
      codigo: 203,
      modelo: 'NF-e',
    });

    expect(texto).toContain('habilitado para emitir NF-e');
    expect(texto).not.toContain('CSC');
  });

  it.each([462, 463, 464])('%i orienta a conferir o CSC da NFC-e', (codigo) => {
    const texto = orientacaoRejeicaoFiscal({
      origem: 'SEFAZ',
      codigo,
      modelo: 'NFC-e',
    });

    expect(texto).toContain('CSC');
    expect(texto).toContain('ative a NFC-e de novo');
  });

  it('códigos de CSC não valem para a NF-e, que não tem QR Code', () => {
    expect(
      orientacaoRejeicaoFiscal({
        origem: 'SEFAZ',
        codigo: 464,
        modelo: 'NF-e',
      }),
    ).toBeNull();
  });

  it('607 do provedor diz que nada foi à SEFAZ e quem reativa a licença', () => {
    const texto = orientacaoRejeicaoFiscal({
      origem: 'PROVEDOR',
      codigo: 607,
      modelo: 'NFC-e',
    });

    expect(texto).toContain('nada foi enviado à SEFAZ');
    expect(texto).toContain('não é falha');
    expect(texto).toContain('suporte da Atrupe');
  });

  it('a origem separa as tabelas: 607 da SEFAZ não é a licença do provedor', () => {
    expect(
      orientacaoRejeicaoFiscal({
        origem: 'SEFAZ',
        codigo: 607,
        modelo: 'NFC-e',
      }),
    ).toBeNull();
  });

  it('aceita o código como texto, como o provedor às vezes manda', () => {
    expect(
      orientacaoRejeicaoFiscal({
        origem: 'SEFAZ',
        codigo: '203',
        modelo: 'NFC-e',
      }),
    ).not.toBeNull();
  });

  it.each([undefined, null, 'abc', 225, 999])(
    'sem entrada na lista (%p) não acrescenta nada',
    (codigo) => {
      expect(
        orientacaoRejeicaoFiscal({ origem: 'SEFAZ', codigo, modelo: 'NFC-e' }),
      ).toBeNull();
    },
  );
});

describe('motivoComOrientacao', () => {
  it('separa retorno e orientação por uma linha em branco', () => {
    expect(motivoComOrientacao('Rejeicao: X', 'O que fazer (y): z')).toBe(
      'Rejeicao: X\n\nO que fazer (y): z',
    );
  });

  it('sem orientação, devolve o motivo como veio', () => {
    expect(motivoComOrientacao('Rejeicao: X', null)).toBe('Rejeicao: X');
    expect(motivoComOrientacao(undefined, null)).toBeNull();
  });

  it('sem motivo, a orientação basta', () => {
    expect(motivoComOrientacao(undefined, 'O que fazer (y): z')).toBe(
      'O que fazer (y): z',
    );
  });
});

describe('mensagemComOrientacao', () => {
  it('junta na mesma linha, porque o toast não preserva quebras', () => {
    expect(mensagemComOrientacao('NFC-e rejeitada: X', 'O que fazer: y')).toBe(
      'NFC-e rejeitada: X. O que fazer: y',
    );
  });

  it('não duplica o ponto final', () => {
    expect(
      mensagemComOrientacao('Recusada (código 607).', 'O que fazer: y'),
    ).toBe('Recusada (código 607). O que fazer: y');
  });

  it('sem orientação, a mensagem fica igual', () => {
    expect(mensagemComOrientacao('NFC-e rejeitada: X', null)).toBe(
      'NFC-e rejeitada: X',
    );
  });
});
