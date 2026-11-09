import { exampleCodeFor, isExampleProduct } from './example-products';

describe('isExampleProduct', () => {
  it('reconhece o exemplo intacto', () => {
    expect(
      isExampleProduct({ isStandard: true, code: 'QUALQUER', name: 'x' }),
    ).toBe(true);
  });

  it('reconhece o exemplo editado pela tela, que perde o isStandard', () => {
    // Na Terabyte, o "Banner" teve o código trocado de BANER para BANNER e
    // manteve o nome; o "Adesivo Blackout Impresso" manteve o código.
    expect(
      isExampleProduct({ isStandard: false, code: 'BANNER', name: 'Banner' }),
    ).toBe(true);
    expect(
      isExampleProduct({
        isStandard: false,
        code: 'ADBLK',
        name: 'Adesivo preto',
      }),
    ).toBe(true);
  });

  it('compara o nome sem acento, caixa e espaço sobrando', () => {
    expect(
      isExampleProduct({
        isStandard: false,
        code: 'X1',
        name: '  impressao   a4 ',
      }),
    ).toBe(true);
  });

  it('não confunde produto do cliente com exemplo', () => {
    expect(
      isExampleProduct({
        isStandard: false,
        code: 'BAN06',
        name: 'BANNER LONA 440G',
      }),
    ).toBe(false);
  });
});

describe('exampleCodeFor', () => {
  it('acrescenta o sufixo e evita código já usado', () => {
    expect(exampleCodeFor('ADREC', new Set())).toBe('ADREC-EXEMPLO');
    expect(exampleCodeFor('ADREC', new Set(['adrec-exemplo']))).toBe(
      'ADREC-EXEMPLO-2',
    );
  });
});
