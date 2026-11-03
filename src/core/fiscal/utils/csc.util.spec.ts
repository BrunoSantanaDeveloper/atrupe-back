import { aparaCsc, problemaNoCsc } from './csc.util';

const CSC_36 = 'ABCDEF12-3456-7890-ABCD-EF1234567890';

describe('aparaCsc', () => {
  it('tira o espaço das pontas, como o CSC colado do portal', () => {
    // O da Atrupe ficou com 37 caracteres em 23/10/2026 por um espaço assim.
    expect(aparaCsc(` ${CSC_36}`)).toBe(CSC_36);
    expect(aparaCsc(`${CSC_36}\n`)).toBe(CSC_36);
  });

  it('vazio ou só espaços vira null', () => {
    expect(aparaCsc('   ')).toBeNull();
    expect(aparaCsc('')).toBeNull();
    expect(aparaCsc(null)).toBeNull();
    expect(aparaCsc(undefined)).toBeNull();
  });
});

describe('problemaNoCsc', () => {
  it('aceita o formato do portal da SEFAZ', () => {
    expect(problemaNoCsc('1', CSC_36)).toBeNull();
    expect(problemaNoCsc('000001', CSC_36)).toBeNull();
  });

  it('cobra o CSC quando falta o ID ou o código', () => {
    expect(problemaNoCsc(null, CSC_36)).toContain('não configurado');
    expect(problemaNoCsc('1', null)).toContain('não configurado');
  });

  it('recusa identificador com mais de 6 dígitos, que o provedor não guarda', () => {
    const problema = problemaNoCsc('374425537129440041', CSC_36);

    expect(problema).toContain('até 6 dígitos');
    expect(problema).toContain('18 caracteres');
  });

  it('recusa identificador que não é número', () => {
    expect(problemaNoCsc('ID-1', CSC_36)).toContain('até 6 dígitos');
  });

  it('recusa código com mais de 36 caracteres', () => {
    expect(problemaNoCsc('1', `${CSC_36}X`)).toContain('até 36 caracteres');
  });
});
