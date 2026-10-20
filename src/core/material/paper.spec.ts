import {
  NO_PAPER,
  PaperColumns,
  changedPaperColumns,
  fitsIn,
  hasPaperValues,
  paperColumnsOf,
  paperInputOf,
  resolvePaper,
  sheetSizeOf,
} from './paper';

/**
 * O papel (Papéis no LITE, 13/10/2026): o formato padrão preenche a folha,
 * o personalizado exige a medida, e a área útil vem inteira e cabe na folha.
 */
const paper = (over: Partial<PaperColumns> = {}): PaperColumns => ({
  ...NO_PAPER,
  ...over,
});

describe('papel', () => {
  it('as folhas padrão, em mm', () => {
    expect(
      ['A4', 'A3', 'SRA3', 'A3_PLUS'].map((format) =>
        sheetSizeOf(format as any),
      ),
    ).toEqual([
      { width: 210, height: 297 },
      { width: 297, height: 420 },
      { width: 320, height: 450 },
      { width: 329, height: 483 },
    ]);
    expect(sheetSizeOf('CUSTOM')).toBeNull();
    expect(sheetSizeOf(null)).toBeNull();
  });

  it('o formato padrão preenche a folha', () => {
    expect(
      resolvePaper(NO_PAPER, { sheetFormat: 'SRA3', grammage: 300 }),
    ).toEqual(
      paper({
        grammage: 300,
        sheetFormat: 'SRA3',
        sheetWidth: 320,
        sheetHeight: 450,
      }),
    );
  });

  it('a medida do formato padrão vale em pé ou deitada; outra é recusada', () => {
    expect(
      resolvePaper(NO_PAPER, {
        sheetFormat: 'A4',
        sheetWidth: 297,
        sheetHeight: 210,
      }),
    ).toMatchObject({ sheetWidth: 297, sheetHeight: 210 });
    expect(() =>
      resolvePaper(NO_PAPER, {
        sheetFormat: 'A4',
        sheetWidth: 300,
        sheetHeight: 300,
      }),
    ).toThrow(
      'A folha A4 tem 210 × 297 mm: para outra medida, use o formato personalizado',
    );
  });

  it('trocar o formato padrão troca a folha; mudar só a medida dele, não', () => {
    const sra3 = paper({
      sheetFormat: 'SRA3',
      sheetWidth: 320,
      sheetHeight: 450,
    });
    expect(resolvePaper(sra3, { sheetFormat: 'A3_PLUS' })).toMatchObject({
      sheetWidth: 329,
      sheetHeight: 483,
    });
    expect(() => resolvePaper(sra3, { sheetWidth: 330 })).toThrow(
      'A folha SRA3 tem 320 × 450 mm',
    );
  });

  it('o personalizado exige a largura e a altura da folha', () => {
    expect(() =>
      resolvePaper(NO_PAPER, { sheetFormat: 'CUSTOM', sheetWidth: 330 }),
    ).toThrow(
      'No formato personalizado, informe a largura e a altura da folha',
    );
    expect(
      resolvePaper(NO_PAPER, {
        sheetFormat: 'CUSTOM',
        sheetWidth: 330,
        sheetHeight: 480,
      }),
    ).toMatchObject({ sheetWidth: 330, sheetHeight: 480 });
  });

  it('no cadastro do LITE, o formato é obrigatório', () => {
    expect(() =>
      resolvePaper(NO_PAPER, { grammage: 90 }, { requireFormat: true }),
    ).toThrow('Informe o formato da folha');
  });

  it('a área útil vem inteira, cabe na folha (em pé ou deitada) e vazia é a folha', () => {
    const sra3 = { sheetFormat: 'SRA3' as const };
    expect(
      resolvePaper(NO_PAPER, { ...sra3, usableWidth: 310, usableHeight: 440 }),
    ).toMatchObject({ usableWidth: 310, usableHeight: 440 });
    expect(
      resolvePaper(NO_PAPER, { ...sra3, usableWidth: 440, usableHeight: 310 }),
    ).toMatchObject({ usableWidth: 440, usableHeight: 310 });
    expect(() => resolvePaper(NO_PAPER, { ...sra3, usableWidth: 310 })).toThrow(
      'Informe a largura e a altura da área útil, ou deixe as duas vazias',
    );
    expect(() =>
      resolvePaper(NO_PAPER, { ...sra3, usableWidth: 330, usableHeight: 440 }),
    ).toThrow('A área útil não pode ser maior que a folha');
    expect(() =>
      resolvePaper(NO_PAPER, { usableWidth: 100, usableHeight: 100 }),
    ).toThrow('Informe a folha antes da área útil');
    // Limpar a área útil volta à folha inteira
    expect(
      resolvePaper(
        paper({
          sheetFormat: 'A4',
          sheetWidth: 210,
          sheetHeight: 297,
          usableWidth: 200,
          usableHeight: 287,
        }),
        { usableWidth: null, usableHeight: null },
      ),
    ).toMatchObject({ usableWidth: null, usableHeight: null });
  });

  it('a folha menor que a área útil gravada é recusada', () => {
    const sra3 = paper({
      sheetFormat: 'SRA3',
      sheetWidth: 320,
      sheetHeight: 450,
      usableWidth: 310,
      usableHeight: 440,
    });
    expect(() => resolvePaper(sra3, { sheetFormat: 'A4' })).toThrow(
      'A área útil não pode ser maior que a folha',
    );
  });

  it('os campos que vieram, as colunas do registro e só o que muda', () => {
    expect(
      paperInputOf({ grammage: 90, sheetFormat: undefined, usableWidth: null }),
    ).toEqual({ grammage: 90, usableWidth: null });
    expect(hasPaperValues({ usableWidth: null })).toBe(false);
    expect(hasPaperValues({ grammage: 90 })).toBe(true);
    expect(paperColumnsOf({ grammage: 90 })).toEqual(paper({ grammage: 90 }));
    expect(
      changedPaperColumns(
        paper({ grammage: 90 }),
        paper({ grammage: 90, sheetFormat: 'A4' }),
      ),
    ).toEqual({ sheetFormat: 'A4' });
    expect(fitsIn({ width: 90, height: 50 }, { width: 50, height: 90 })).toBe(
      true,
    );
  });
});
