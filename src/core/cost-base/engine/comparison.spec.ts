import {
  DEFAULT_ACCOUNTS,
  MachineAsset,
  assetCostSourceOf,
  defaultAccountOf,
  financialCostSourceOf,
  itemMaterialCostOf,
  materialSourceOf,
  readingVolumeOf,
  soldVolumesOf,
  sourceAccountsOf,
  usesOf,
  volumeOf,
} from './comparison';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

// O período de julho a setembro de 2026
const START = day('2026-07-01');
const END = day('2026-10-01');

describe('comparativo: volume pelas leituras do contador', () => {
  it('a última até o fim menos a última antes do início', () => {
    const readings = [
      { date: day('2026-05-10'), value: 900 },
      { date: day('2026-06-30'), value: 1_000 },
      { date: day('2026-08-15'), value: 2_500 },
      { date: day('2026-09-30'), value: 4_200 },
      // Depois do período: não entra
      { date: day('2026-10-01'), value: 9_000 },
    ];
    expect(readingVolumeOf(readings, START, END)).toBe(3_200);
  });

  it('sem leitura antes do início, vale a primeira de dentro do período', () => {
    const readings = [
      { date: day('2026-09-30'), value: 4_200 },
      { date: day('2026-07-20'), value: 1_200 },
    ];
    expect(readingVolumeOf(readings, START, END)).toBe(3_000);
  });

  it('com uma leitura só, ou nenhuma dentro do período, não há volume', () => {
    expect(
      readingVolumeOf([{ date: day('2026-08-01'), value: 10 }], START, END),
    ).toBeNull();
    expect(
      readingVolumeOf(
        [
          { date: day('2026-05-01'), value: 10 },
          { date: day('2026-06-01'), value: 20 },
        ],
        START,
        END,
      ),
    ).toBeNull();
    expect(readingVolumeOf([], START, END)).toBeNull();
  });

  it('no mesmo dia, o contador maior é o mais recente', () => {
    const readings = [
      { date: day('2026-09-30'), value: 4_200 },
      { date: day('2026-09-30'), value: 4_000 },
      { date: day('2026-06-30'), value: 1_000 },
    ];
    expect(readingVolumeOf(readings, START, END)).toBe(3_200);
  });
});

describe('comparativo: o que o retrato da venda usou', () => {
  it('as linhas das etapas, com as da parte; as caixas de dentro da parte não repetem', () => {
    const snapshot = {
      cost: 9_999,
      stages: [
        {
          blockId: 'b1',
          lines: [
            {
              kind: 'MACHINE',
              resourceId: 'machine:s1',
              quantity: 2.5,
              unit: 'm²',
              cost: 725,
            },
            // A linha da parte, já somada na etapa
            {
              kind: 'MATERIAL',
              resourceId: 'material:m1',
              quantity: 3,
              unit: 'm²',
              cost: 3_750,
            },
          ],
          parts: [
            {
              blockId: 'p1',
              lines: [
                {
                  kind: 'MATERIAL',
                  resourceId: 'material:m1',
                  quantity: 3,
                  unit: 'm²',
                },
              ],
              parts: null,
            },
          ],
        },
        {
          blockId: 'b2',
          lines: [
            // Na lista, cada entrada é um uso
            {
              kind: 'MATERIAL',
              resourceId: null,
              quantity: null,
              unit: 'un',
              cost: 300,
              entries: [
                {
                  resourceId: 'material:ilhos',
                  quantity: 8,
                  unit: 'un',
                  cost: 200,
                },
                {
                  resourceId: 'material:corda',
                  quantity: 2,
                  unit: 'm',
                  cost: 100,
                },
              ],
            },
          ],
        },
      ],
    };
    expect(usesOf(snapshot)).toEqual([
      {
        kind: 'MACHINE',
        resourceId: 'machine:s1',
        quantity: 2.5,
        unit: 'm²',
        cost: 725,
      },
      {
        kind: 'MATERIAL',
        resourceId: 'material:m1',
        quantity: 3,
        unit: 'm²',
        cost: 3_750,
      },
      {
        kind: 'MATERIAL',
        resourceId: 'material:ilhos',
        quantity: 8,
        unit: 'un',
        cost: 200,
      },
      {
        kind: 'MATERIAL',
        resourceId: 'material:corda',
        quantity: 2,
        unit: 'm',
        cost: 100,
      },
    ]);
  });

  it('o processo acrescentado (linhas) e a parte acrescentada (etapas)', () => {
    const process = [
      {
        kind: 'MACHINE',
        resourceId: 'machine-group:g1',
        quantity: 84,
        unit: 'km',
        cost: 6_720,
      },
    ];
    const part = [{ lines: process, parts: [{ lines: process }] }];
    expect(usesOf(process)).toHaveLength(1);
    expect(usesOf(part)).toEqual(usesOf(process));
    // O terceirizado não tem retrato; lixo não quebra a conta
    expect(usesOf(null)).toEqual([]);
    expect(usesOf({ stages: 'x' })).toEqual([]);
    expect(usesOf([1, null, { kind: 'MACHINE' }])).toEqual([
      { kind: 'MACHINE', resourceId: null, quantity: 0, unit: '', cost: 0 },
    ]);
  });
});

describe('comparativo: volume vendido das máquinas', () => {
  // A Solvente com duas configurações em m²; a Sublimática sem tempo por
  // unidade; dois carros no grupo (um sem configuração)
  const assets: MachineAsset[] = [
    {
      id: 'solvente',
      groupId: null,
      productivity: 400,
      setups: [
        {
          id: '4p',
          unit: 'M2',
          timePerUnit: 5,
          monthlyProductivity: 300,
        },
        {
          id: '6p',
          unit: 'M2',
          timePerUnit: 8,
          monthlyProductivity: 100,
        },
      ],
    },
    {
      id: 'sublimatica',
      groupId: null,
      productivity: 164,
      setups: [
        { id: 'std', unit: 'M2', timePerUnit: 0, monthlyProductivity: 164 },
      ],
    },
    {
      id: 'fiorino',
      groupId: 'carros',
      productivity: 3_000,
      setups: [
        {
          id: 'urbano',
          unit: 'KM',
          timePerUnit: 2,
          monthlyProductivity: 3_000,
        },
      ],
    },
    { id: 'strada', groupId: 'carros', productivity: 1_000, setups: [] },
  ];
  const groups = [{ id: 'carros', unit: 'KM' as const }];
  const use = (resourceId: string, quantity: number, unit: string) => ({
    kind: 'MACHINE',
    resourceId,
    quantity,
    unit,
    cost: 0,
  });

  it('a linha da configuração vem na unidade dela; em tempo, pelo tempo por unidade', () => {
    const sold = soldVolumesOf(
      [
        use('machine:4p', 10, 'm²'),
        use('machine:4p', 2.5, 'm²'),
        // 60 minutos a 8 min/m²
        use('machine:6p', 60, 'min'),
        use('machine:6p', 0.5, 'h'),
      ],
      assets,
      groups,
    );
    expect(sold.setups.get('4p')).toBe(12.5);
    expect(sold.setups.get('6p')).toBe(7.5 + 3.75);
    expect(sold.assets.get('solvente')).toBe(12.5 + 11.25);
  });

  it('sem tempo por unidade, outra unidade ou configuração de fora não contam', () => {
    const sold = soldVolumesOf(
      [
        use('machine:std', 120, 'min'),
        use('machine:4p', 3, 'kg'),
        use('machine:outra', 5, 'm²'),
        use('material:m1', 5, 'm²'),
        use('machine:4p', 0, 'm²'),
      ],
      assets,
      groups,
    );
    expect(sold.setups.size).toBe(0);
    expect(sold.assets.size).toBe(0);
  });

  it('o grupo se reparte pela produtividade mensal de cada configuração', () => {
    const sold = soldVolumesOf(
      [use('machine-group:carros', 800, 'km')],
      assets,
      groups,
    );
    // 3.000 e 1.000 km por mês: 75 % e 25 %
    expect(sold.setups.get('urbano')).toBe(600);
    expect(sold.assets.get('fiorino')).toBe(600);
    expect(sold.assets.get('strada')).toBe(200);
  });

  it('o grupo em tempo: os minutos repartidos viram unidades pelo tempo de cada uma', () => {
    const sold = soldVolumesOf(
      [use('machine-group:carros', 120, 'min')],
      assets,
      groups,
    );
    // 90 minutos para a Fiorino (2 min/km); a Strada não tem tempo por km
    expect(sold.setups.get('urbano')).toBe(45);
    expect(sold.assets.has('strada')).toBe(false);
  });
});

describe('comparativo: as fontes dos custos dos bens', () => {
  it('o volume: leituras, depois vendido, depois produtividade × meses', () => {
    expect(
      volumeOf({ readings: 3_200, sold: 50, productivity: 100, months: 3 }),
    ).toEqual({ basis: 'READINGS', volume: 3_200, perMonth: 100 });
    // Leitura zerada é volume: o carro não saiu
    expect(
      volumeOf({ readings: 0, sold: 50, productivity: 100, months: 3 }),
    ).toEqual({ basis: 'READINGS', volume: 0, perMonth: 100 });
    expect(
      volumeOf({ readings: null, sold: 50, productivity: 100, months: 3 }),
    ).toEqual({ basis: 'SOLD', volume: 50, perMonth: 100 });
    expect(
      volumeOf({ readings: null, sold: 0, productivity: 100, months: 3 }),
    ).toEqual({ basis: 'PRODUCTIVITY', volume: 300, perMonth: 100 });
  });

  const cost = {
    id: 'c1',
    label: 'Tinta',
    // R$ 50,00 a cada 100 m²
    unitCost: 5_000,
    yieldAmount: 100,
    yieldUnit: 'UNIT' as const,
    monthlyCost: 0,
  };

  it('o variável: custo por unidade × volume, com a base no texto', () => {
    expect(
      assetCostSourceOf({
        assetName: 'Impressora Solvente',
        unit: 'M2',
        cost,
        volume: { basis: 'SOLD', volume: 1_234, perMonth: 400 },
        months: 12,
      }),
    ).toEqual({
      id: 'c1',
      name: 'Impressora Solvente',
      detail: 'Tinta — R$ 0,50/m² × 1.234 m² vendidos',
      value: 61_700,
    });
    expect(
      assetCostSourceOf({
        assetName: 'Fiorino',
        unit: 'KM',
        cost: { ...cost, label: 'Combustível', unitCost: 80, yieldAmount: 1 },
        volume: { basis: 'READINGS', volume: 3_200, perMonth: 3_000 },
        months: 3,
      }).detail,
    ).toBe('Combustível — R$ 0,80/km × 3.200 km pelas leituras');
    const byProductivity = assetCostSourceOf({
      assetName: 'Impressora Solvente',
      unit: 'M2',
      cost: { ...cost, label: 'Tinta (4 passes)' },
      volume: { basis: 'PRODUCTIVITY', volume: 2_160, perMonth: 180 },
      months: 12,
    });
    expect(byProductivity.detail).toBe(
      'Tinta (4 passes) — R$ 0,50/m² pela produtividade do cadastro (180 m²/mês × 12 meses)',
    );
    expect(byProductivity.value).toBe(108_000);
  });

  it('fração de centavo por unidade aparece no texto e o valor arredonda ao centavo', () => {
    // R$ 1,00 a cada 300 m²
    const source = assetCostSourceOf({
      assetName: 'Plotter',
      unit: 'M2',
      cost: { ...cost, unitCost: 100, yieldAmount: 300 },
      volume: { basis: 'SOLD', volume: 1_000, perMonth: 0 },
      months: 1,
    });
    expect(source.detail).toBe('Tinta — R$ 0,0033/m² × 1.000 m² vendidos');
    expect(source.value).toBe(333);
  });

  it('o fixo continua o custo mensal × meses', () => {
    const fixed = {
      id: 'c2',
      label: 'Manutenção preventiva',
      unitCost: 250_002,
      yieldAmount: 6,
      yieldUnit: 'MONTH' as const,
      monthlyCost: 41_667,
    };
    const volume = { basis: 'PRODUCTIVITY' as const, volume: 0, perMonth: 0 };
    expect(
      assetCostSourceOf({
        assetName: 'Impressora Solvente',
        unit: 'M2',
        cost: fixed,
        volume,
        months: 12,
      }),
    ).toEqual({
      id: 'c2',
      name: 'Impressora Solvente',
      detail: 'Manutenção preventiva — a cada 6 meses',
      value: 500_004,
    });
    expect(
      assetCostSourceOf({
        assetName: 'Impressora Solvente',
        unit: 'M2',
        cost: { ...fixed, label: 'Seguro', yieldAmount: 1 },
        volume,
        months: 1,
      }).detail,
    ).toBe('Seguro — todo mês');
  });
});

describe('comparativo: as fontes sem bem', () => {
  it('custo financeiro: o percentual da Precificação × o recebido', () => {
    // 1,5 % (15 décimos de ponto) de R$ 120.000,00
    expect(financialCostSourceOf(15, 12_000_000)).toEqual({
      id: 'financial-cost',
      name: 'Custo financeiro',
      detail: '1,5% do recebido (R$ 120.000,00)',
      value: 180_000,
    });
    expect(financialCostSourceOf(30, 0)?.detail).toBe(
      '3% do recebido (R$ 0,00)',
    );
    // Sem percentual na Precificação, não há estimativa
    expect(financialCostSourceOf(0, 12_000_000)).toBeNull();
  });

  it('material do item: as linhas de material do retrato e das linhas acrescentadas', () => {
    const uses = usesOf({
      stages: [
        {
          lines: [
            { kind: 'MATERIAL', cost: 3_750 },
            { kind: 'MACHINE', cost: 725 },
            { kind: 'LABOR', cost: 1_000 },
          ],
          parts: [{ lines: [{ kind: 'MATERIAL', cost: 9_999 }] }],
        },
      ],
    });
    const added = usesOf([{ kind: 'MATERIAL', cost: 250 }]);
    expect(
      itemMaterialCostOf({
        origin: 'PRODUCT',
        quantity: 3,
        materialCost: 1_000,
        uses: [...uses, ...added],
      }),
    ).toBe(4_000);
  });

  it('material de venda direta: quantidade × o custo de hoje', () => {
    expect(
      itemMaterialCostOf({
        origin: 'MATERIAL',
        quantity: 4,
        materialCost: 1_250,
        uses: [],
      }),
    ).toBe(5_000);
    // Sem custo no cadastro, não soma
    expect(
      itemMaterialCostOf({
        origin: 'MATERIAL',
        quantity: 4,
        materialCost: null,
        uses: [],
      }),
    ).toBe(0);
  });

  it('o texto do material conta as vendas', () => {
    expect(materialSourceOf(123_456.4, 42)).toEqual({
      id: 'sold-material',
      name: 'Material das vendas',
      detail: 'Material das composições vendidas (42 vendas)',
      value: 123_456,
    });
    expect(materialSourceOf(0, 1).detail).toBe(
      'Material das composições vendidas (1 venda)',
    );
  });

  it('a conta padrão: pela descrição, sem acento e sem caixa, na natureza esperada', () => {
    const account = (id: string, description: string, nature: string) => ({
      id,
      description,
      nature: { description: nature },
    });
    const accounts = [
      account('a1', 'Materia prima', 'Despesas Variáveis'),
      account('a2', '  MATÉRIA-PRIMA ', 'operacional'),
      account('a3', 'Matéria Prima', 'Operacional'),
      account('a4', 'Tarifa de Cartao de Credito', 'Outras'),
    ];
    // Na natureza esperada, a primeira na ordem do plano; o hífen da
    // grafia "matéria-prima" conta como espaço
    expect(defaultAccountOf(accounts, DEFAULT_ACCOUNTS.material)?.id).toBe(
      'a2',
    );
    // Fora da natureza esperada, ainda vale a da descrição
    expect(defaultAccountOf(accounts, DEFAULT_ACCOUNTS.financialCost)?.id).toBe(
      'a4',
    );
    expect(
      defaultAccountOf(
        [account('x', 'Matérias primas', 'Operacional')],
        DEFAULT_ACCOUNTS.material,
      ),
    ).toBeNull();
    expect(defaultAccountOf([], DEFAULT_ACCOUNTS.material)).toBeNull();
  });
});

describe('comparativo: as contas escolhidas', () => {
  const account = (id: string, description: string, nature: string) => ({
    id,
    description,
    nature: { description: nature },
  });
  const accounts = [
    account('mp', 'Matéria Prima', 'Operacional'),
    account('tinta', 'Tinta', 'Operacional'),
    account('cartao', 'Tarifa de Cartão de Crédito', 'Despesas Financeiras'),
  ];

  it('a escolhida vale enquanto for uma das contas do comparativo', () => {
    expect(
      sourceAccountsOf(accounts, {
        materialSubCategoryId: 'tinta',
        financialCostSubCategoryId: null,
      }),
    ).toEqual({ material: 'tinta', financialCost: 'cartao' });
    // Inativa, administrativa ou de outra empresa: volta ao padrão
    expect(
      sourceAccountsOf(accounts, {
        materialSubCategoryId: 'sumiu',
        financialCostSubCategoryId: 'tinta',
      }),
    ).toEqual({ material: 'mp', financialCost: 'tinta' });
    expect(sourceAccountsOf(accounts, null)).toEqual({
      material: 'mp',
      financialCost: 'cartao',
    });
    expect(sourceAccountsOf([accounts[1]], null)).toEqual({
      material: null,
      financialCost: null,
    });
  });
});
