import {
  fixedSectors,
  isZeroed,
  itemFlow,
  parseStages,
  unitSectorFromFlow,
  withFixedStages,
} from './production-flow';

describe('o fluxo de produção do LITE (área 9 §4.16)', () => {
  it('lê o fluxo em JSON ou texto, e o sem isActive vale como ativo', () => {
    expect(parseStages('[{"id":"a"},{"id":"b","isActive":false}]')).toEqual([
      { id: 'a', isActive: true },
      { id: 'b', isActive: false },
    ]);
    expect(parseStages(null)).toEqual([]);
    expect(parseStages('quebrado')).toEqual([]);
  });

  it('os fixos são os setores das etapas de cobrança, sem repetir', () => {
    expect(
      fixedSectors([
        { sectorId: 'imp' },
        { sectorId: null },
        { sectorId: 'inst' },
        { sectorId: 'imp' },
      ]),
    ).toEqual(['imp', 'inst']);
  });

  it('o fixo fica no lugar e ativo; o que falta entra no fim', () => {
    expect(
      withFixedStages(
        [
          { id: 'criacao', isActive: true },
          { id: 'imp', isActive: false },
          { id: 'acab', isActive: false },
        ],
        ['imp', 'inst'],
      ),
    ).toEqual([
      { id: 'criacao', isActive: true },
      { id: 'imp', isActive: true },
      { id: 'acab', isActive: false },
      { id: 'inst', isActive: true },
    ]);
  });

  it('a etapa zerada no pedido: sem quantidade ou sem a medida dela', () => {
    expect(isZeroed(undefined)).toBe(true);
    expect(
      isZeroed({
        productItemId: 'x',
        quantity: 1,
        unitKind: 'DURATION',
        duration: 0,
      }),
    ).toBe(true);
    expect(
      isZeroed({
        productItemId: 'x',
        quantity: 1,
        unitKind: 'DURATION',
        duration: 480,
      }),
    ).toBe(false);
    expect(
      isZeroed({
        productItemId: 'x',
        quantity: 1,
        unitKind: 'AREA',
        width: 1000,
        height: 0,
      }),
    ).toBe(true);
    expect(
      isZeroed({ productItemId: 'x', quantity: 0, unitKind: 'UNITY' }),
    ).toBe(true);
    expect(
      isZeroed({ productItemId: 'x', quantity: 2, unitKind: 'UNITY' }),
    ).toBe(false);
  });

  it('o carro adesivado: Criação livre, Impressão e Instalação fixas', () => {
    const stages = [
      { id: 'criacao', isActive: true },
      { id: 'imp', isActive: true },
      { id: 'inst', isActive: true },
    ];
    expect(
      itemFlow(stages, [
        { sectorId: 'imp', zeroed: false },
        { sectorId: 'inst', zeroed: false },
      ]),
    ).toEqual([
      { stageId: 'criacao', fixed: false },
      { stageId: 'imp', fixed: true },
      { stageId: 'inst', fixed: true },
    ]);
  });

  it('a Instalação zerada no pedido (o cliente retira) sai deste pedido', () => {
    const stages = [
      { id: 'imp', isActive: true },
      { id: 'inst', isActive: true },
    ];
    expect(
      itemFlow(stages, [
        { sectorId: 'imp', zeroed: false },
        { sectorId: 'inst', zeroed: true },
      ]),
    ).toEqual([{ stageId: 'imp', fixed: true }]);
  });

  it('o fixo que faltava no fluxo salvo entra no fim; o livre desligado não entra', () => {
    expect(
      itemFlow(
        [
          { id: 'criacao', isActive: false },
          { id: 'acab', isActive: true },
        ],
        [
          { sectorId: 'imp', zeroed: false },
          { sectorId: null, zeroed: false },
        ],
      ),
    ).toEqual([
      { stageId: 'acab', fixed: false },
      { stageId: 'imp', fixed: true },
    ]);
  });

  it('o kit da conta nova: setor pelo nome ou, com uma unidade, o do produto', () => {
    const sectors = [
      { id: 'imp', name: 'Impressão' },
      { id: 'inst', name: 'Instalação' },
    ];
    const flow = [
      { id: 'imp', isActive: true },
      { id: 'inst', isActive: true },
    ];
    expect(unitSectorFromFlow('instalação ', 2, 'imp', flow, sectors)).toBe(
      'inst',
    );
    expect(unitSectorFromFlow('Lona', 1, 'imp', flow, sectors)).toBe('imp');
    expect(unitSectorFromFlow('Lona', 2, 'imp', flow, sectors)).toBeNull();
    expect(
      unitSectorFromFlow(
        'Lona',
        1,
        'imp',
        [{ id: 'imp', isActive: false }],
        sectors,
      ),
    ).toBeNull();
  });
});
