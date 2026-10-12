import { evaluateFormula, formulaUsesName, normalizeName } from './formula';

const measure = {
  largura: 2,
  altura: 1.5,
  área: 3,
  perímetro: 7,
  quantidade: 10,
  tempo: 0,
};

describe('fórmula do produto (IP-2)', () => {
  it.each([
    ['largura × altura', 3],
    ['2 * (largura + altura)', 7],
    ['área ÷ 2', 1.5],
    ['largura − altura', 0.5],
    ['-largura + 5', 3],
    ['2 ^ 3', 8],
    ['2 ^ 3 ^ 2', 512],
    ['1,5 * 2', 3],
    ['.5 + .5', 1],
    ['quantidade / 4', 2.5],
    ['cima(quantidade / 4)', 3],
    ['baixo(quantidade / 4)', 2],
    ['arredondar(2,5)', 3],
    ['(largura + altura) * quantidade', 35],
  ])('%s = %p', (expression, value) => {
    expect(evaluateFormula(expression, measure)).toEqual({
      value,
      error: null,
    });
  });

  it('os nomes valem sem acento e sem maiúscula', () => {
    expect(evaluateFormula('AREA + Perimetro', measure).value).toBe(10);
  });

  it('o campo do orçamento entra pelo nome, o mais longo primeiro', () => {
    const vars = { ...measure, nr: 2, 'nr de letras': 12 };

    expect(evaluateFormula('nr de letras * 2', vars).value).toBe(24);
    expect(evaluateFormula('nr * 2', vars).value).toBe(4);
  });

  it('nome parecido com variável não é confundido com ela', () => {
    expect(evaluateFormula('larguras', measure)).toEqual({
      value: null,
      error:
        'Não reconheci "larguras". Use as medidas, os campos do orçamento, números e + − × ÷ ( ).',
    });
  });

  it.each([
    ['', 'Escreva a fórmula.'],
    ['   ', 'Escreva a fórmula.'],
    ['largura +', 'A fórmula terminou antes da hora.'],
    ['(largura + 1', 'Falta fechar um parêntese.'],
    // Sem o parêntese, "cima" não é a função: é um nome desconhecido
    [
      'cima largura',
      'Não reconheci "cima largura". Use as medidas, os campos do orçamento, números e + − × ÷ ( ).',
    ],
    ['largura 2', 'Sobrou "2" no fim da fórmula.'],
    [
      'largura / tempo',
      'Divisão por zero: confira o campo que está no divisor.',
    ],
    ['* 2', 'Não esperava "*" aqui.'],
    [
      'largura x altura',
      'Não reconheci "x altura". Use as medidas, os campos do orçamento, números e + − × ÷ ( ).',
    ],
  ])('%p responde "%s"', (expression, error) => {
    expect(evaluateFormula(expression, measure)).toEqual({
      value: null,
      error,
    });
  });

  it('a conta que não dá número é recusada', () => {
    expect(evaluateFormula('10 ^ 400', measure)).toEqual({
      value: null,
      error: 'A conta não deu um número.',
    });
  });

  it('"usado em": a fórmula lê o nome?', () => {
    expect(formulaUsesName('cima(perímetro ÷ distância)', 'Distância')).toBe(
      true,
    );
    expect(formulaUsesName('largura × altura', 'Distância')).toBe(false);
  });

  it('o ^ não some na comparação de nomes', () => {
    expect(normalizeName('Área^')).toBe('area^');
  });
});
