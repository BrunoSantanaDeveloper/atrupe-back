import {
  INF_CPL_MAX_LENGTH,
  sanitizeFiscalText,
  sanitizeInfCpl,
} from './fiscal-text.util';

// Montados por código: escrever os caracteres literalmente no arquivo os
// tornaria invisíveis em revisão — que é justamente o problema que a função
// resolve.
const QUEBRA = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const CONTROLE = String.fromCharCode(1);
const NBSP = String.fromCharCode(160);

/**
 * Texto colado de Word/Excel chega com quebra de linha, tabulação e NBSP.
 * Caractere de controle não é válido em XML e derruba a validação do provedor
 * com um erro genérico, que não diz qual campo causou o problema.
 */
describe('sanitizeFiscalText', () => {
  it('troca quebra de linha por espaço em vez de remover', () => {
    // Remover juntaria as frases: 'portariaEntregar'.
    expect(sanitizeFiscalText('portaria' + QUEBRA + 'Entregar')).toBe(
      'portaria Entregar',
    );
  });

  it('remove caracteres de controle', () => {
    expect(sanitizeFiscalText('Pedido' + CONTROLE + ' 4821')).toBe(
      'Pedido 4821',
    );
  });

  it('normaliza NBSP e espaços repetidos', () => {
    expect(sanitizeFiscalText('Pedido' + NBSP + NBSP + ' 4821')).toBe(
      'Pedido 4821',
    );
  });

  it('aceita vazio, nulo e indefinido', () => {
    expect(sanitizeFiscalText('')).toBe('');
    expect(sanitizeFiscalText(null)).toBe('');
    expect(sanitizeFiscalText(undefined)).toBe('');
  });

  it('preserva acentuação', () => {
    expect(sanitizeFiscalText('Endereço de entrega — portaria')).toBe(
      'Endereço de entrega — portaria',
    );
  });
});

describe('sanitizeInfCpl', () => {
  it('trunca no limite do leiaute em vez de barrar a emissão', () => {
    const longo = 'a'.repeat(INF_CPL_MAX_LENGTH + 500);

    expect(sanitizeInfCpl(longo)).toHaveLength(INF_CPL_MAX_LENGTH);
  });

  it('limpa antes de truncar', () => {
    expect(sanitizeInfCpl('  Pedido' + TAB + '4821  ')).toBe('Pedido 4821');
  });
});
