import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssemblyResource } from './assembly-resource.service';
import {
  EQUIPMENT_SECTOR_LABOR,
  LineRow,
  findByName,
  integerCheck,
  lineUpdateData,
  newLineData,
  newOptionData,
  removeOptionData,
  toEngineLine,
} from './composition-lines';
import { CreateLineDto } from './dto/composition.dto';
import { BASE_RULES, rulesByPosition, rulesOf, mergeRules } from './sale-rules';

const resource = (
  resourceId: string,
  unit: string,
  extra: Partial<AssemblyResource> = {},
): AssemblyResource => ({
  resourceId,
  kind: resourceId.startsWith('labor:') ? 'LABOR' : 'MATERIAL',
  name: resourceId,
  unit,
  unitCost: 100,
  unitSale: null,
  ...extra,
});

const RESOURCES = new Map(
  [
    resource('material:lona', 'm²'),
    resource('material:lona-fosca', 'm²'),
    resource('material:ilhos', 'un'),
    resource('material:couche', 'un', {
      sheet: { width: 297, height: 420, wholeSheets: true },
    }),
    resource('labor:impressao', 'min', { unitCost: 75, unitSale: 200 }),
  ].map((item) => [item.resourceId, item]),
);

const context = (extra = {}) => ({
  resources: RESOURCES,
  sectorSaleUnit: 'HOUR',
  formulaIds: new Set(['fx-1']),
  ...extra,
});

const line = (body: Partial<CreateLineDto>) =>
  newLineData(
    {
      name: 'Material',
      kind: 'MATERIAL',
      mode: 'SINGLE',
      resourceIds: ['material:lona'],
      ...body,
    } as CreateLineDto,
    context(),
  );

const message = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as BadRequestException).message;
  }
  return null;
};

const row = (extra: Partial<LineRow> = {}): LineRow => ({
  id: 'l-1',
  processId: 'p-1',
  blockId: null,
  sourceLineId: null,
  overridden: false,
  addedHere: false,
  name: 'Material',
  kind: 'MATERIAL',
  mode: 'CHOOSE',
  formula: 'PER_AREA',
  perUnit: 1,
  lossPercent: 0,
  minimum: null,
  optional: false,
  optionalDefault: true,
  fieldName: null,
  formulaId: null,
  people: null,
  sheetMargin: null,
  sheetGap: null,
  chargeWholeSheets: null,
  selectedOptionId: 'o-1',
  position: 0,
  createdAt: new Date(),
  options: [
    {
      id: 'o-1',
      lineId: 'l-1',
      resourceId: 'material:lona',
      configName: null,
      perUnit: null,
      lossPercent: null,
      minimum: null,
      position: 0,
    },
  ],
  ...extra,
});

describe('linhas da composição: a linha nova (IP-31)', () => {
  it.each([
    [{ name: '  ' }, 'Informe o nome da linha'],
    [{ resourceIds: [] }, 'Escolha ao menos um recurso'],
    [{ resourceIds: ['material:nao-existe'] }, 'Recurso não encontrado'],
    [
      { resourceIds: ['material:lona', 'material:lona-fosca'] },
      'Recurso único leva um recurso só',
    ],
    [
      { mode: 'CHOOSE', resourceIds: ['material:lona', 'material:ilhos'] },
      'As opções de uma escolha precisam ter a mesma unidade',
    ],
    [
      { mode: 'CHOOSE', resourceIds: ['material:lona', 'material:lona'] },
      'Este recurso já está na linha: dê um nome à configuração',
    ],
    [{ formula: 'CUSTOM' }, 'Escolha a fórmula do produto'],
    [
      { formula: 'CUSTOM', formulaId: 'fx-de-outro' },
      'Escolha a fórmula do produto',
    ],
    [
      { kind: 'LABOR', resourceIds: ['material:lona'] },
      'Este recurso não é do tipo da linha',
    ],
  ] as const)('%j recusa: %s', (body, expected) => {
    expect(message(() => line(body as Partial<CreateLineDto>))).toBe(expected);
  });

  it('mão de obra não entra no setor que vende pelo equipamento (AB-19)', () => {
    expect(
      message(() =>
        newLineData(
          {
            name: 'Impressor',
            kind: 'LABOR',
            mode: 'SINGLE',
            resourceIds: ['labor:impressao'],
          },
          context({ sectorSaleUnit: 'M2' }),
        ),
      ),
    ).toBe(EQUIPMENT_SECTOR_LABOR);
  });

  it('a primeira opção é a escolhida; o padrão é consumo 1, fixo, sem perda', () => {
    const { line: created, options } = line({
      mode: 'CHOOSE',
      resourceIds: ['material:lona', 'material:lona-fosca'],
    });
    expect(options.map((option) => option.resourceId)).toEqual([
      'material:lona',
      'material:lona-fosca',
    ]);
    expect(created).toMatchObject({
      selectedOptionId: options[0].id,
      formula: 'FIXED',
      perUnit: 1,
      lossPercent: 0,
      minimum: null,
      people: null,
    });
  });

  it('a lista nasce sem escolhida, com o vendedor informando (IP-8)', () => {
    const { line: created } = line({
      mode: 'LIST',
      resourceIds: ['material:lona', 'material:ilhos'],
      formula: 'PER_AREA',
      lossPercent: 10,
      minimum: 2,
      perUnit: 3,
    });
    expect(created).toMatchObject({
      selectedOptionId: null,
      formula: 'SELLER',
      perUnit: 0,
      lossPercent: 0,
      minimum: null,
    });
  });

  it('pessoas só na mão de obra, inteiro a partir de 1', () => {
    expect(line({ people: 3 }).line.people).toBeNull();
    const labor = (people?: number) =>
      newLineData(
        {
          name: 'Impressor',
          kind: 'LABOR',
          mode: 'SINGLE',
          resourceIds: ['labor:impressao'],
          people,
        },
        context(),
      ).line.people;
    expect(labor()).toBe(1);
    expect(labor(2)).toBe(2);
  });

  it('a fórmula própria guarda a fórmula; o campo lido vai aparado', () => {
    const { line: created } = line({
      formula: 'CUSTOM',
      formulaId: 'fx-1',
      fieldName: '  Nº de letras ',
    });
    expect(created.formulaId).toBe('fx-1');
    expect(created.fieldName).toBe('Nº de letras');
  });
});

describe('linhas da composição: o ajuste (IP-22, IP-26)', () => {
  const ctx = { formulaIds: new Set(['fx-1']) };

  it('trocar só a opção escolhida não é ajuste (CP-21)', () => {
    const current = row({
      options: [
        ...row().options,
        { ...row().options[0], id: 'o-2', resourceId: 'material:lona-fosca' },
      ],
    });
    expect(lineUpdateData(current, { selectedId: 'o-2' }, ctx)).toMatchObject({
      onlyChoice: true,
      data: { selectedOptionId: 'o-2' },
    });
    expect(
      lineUpdateData(current, { selectedId: 'o-2', perUnit: 2 }, ctx)
        .onlyChoice,
    ).toBe(false);
  });

  it('a opção escolhida precisa ser da linha', () => {
    expect(
      message(() => lineUpdateData(row(), { selectedId: 'o-9' }, ctx)),
    ).toBe('Escolha uma opção desta linha');
  });

  it('fórmula que não é própria zera a fórmula escolhida', () => {
    const current = row({ formula: 'CUSTOM', formulaId: 'fx-1' });
    expect(
      lineUpdateData(current, { formula: 'PER_UNIT' }, ctx).data.formulaId,
    ).toBeNull();
    expect(lineUpdateData(current, { perUnit: 2 }, ctx).data.formulaId).toBe(
      'fx-1',
    );
    expect(
      message(() =>
        lineUpdateData(row(), { formula: 'CUSTOM', formulaId: 'x' }, ctx),
      ),
    ).toBe('Escolha a fórmula do produto');
  });

  it('o valor por opção nulo volta ao da linha; opção de fora é ignorada', () => {
    const { optionUpdates } = lineUpdateData(
      row(),
      {
        optionValues: [
          { id: 'o-1', perUnit: 1.2, lossPercent: null },
          { id: 'o-9', perUnit: 3 },
        ],
      },
      ctx,
    );
    expect(optionUpdates).toEqual([
      {
        id: 'o-1',
        data: { perUnit: 1.2, lossPercent: null, minimum: null },
      },
    ]);
  });

  it('pessoas fora da mão de obra ficam vazias', () => {
    expect(lineUpdateData(row(), { people: 4 }, ctx).data.people).toBeNull();
    expect(
      lineUpdateData(row({ kind: 'LABOR' }), { people: 2.6 }, ctx).data.people,
    ).toBe(3);
  });
});

describe('linhas da composição: as opções (IP-27)', () => {
  const ctx = { resources: RESOURCES, sectorSaleUnit: 'HOUR' };

  it.each([
    [
      { mode: 'SINGLE' },
      'material:lona-fosca',
      undefined,
      'Recurso único não tem opções',
    ],
    [{}, 'material:x', undefined, 'Recurso não encontrado'],
    [{}, 'material:ilhos', undefined, 'As opções desta linha são em m²'],
    [
      {},
      'material:lona',
      undefined,
      'Este recurso já está na linha: dê um nome à configuração',
    ],
  ] as const)('%j + %s recusa', (extra, resourceId, configName, expected) => {
    expect(
      message(() =>
        newOptionData(
          row(extra as Partial<LineRow>),
          { resourceId, configName },
          ctx,
        ),
      ),
    ).toBe(expected);
  });

  it('o mesmo recurso entra de novo com outro nome de configuração', () => {
    const current = row({
      options: [
        ...row().options,
        {
          ...row().options[0],
          id: 'o-2',
          configName: 'Refile',
          position: 1,
        },
      ],
    });
    expect(
      message(() =>
        newOptionData(
          current,
          { resourceId: 'material:lona', configName: 'refile' },
          ctx,
        ),
      ),
    ).toBe('Já existe uma configuração com esse nome');

    const { option } = newOptionData(
      current,
      { resourceId: 'material:lona', configName: ' Bainha ', perUnit: 1.1 },
      ctx,
    );
    expect(option).toMatchObject({
      configName: 'Bainha',
      perUnit: 1.1,
      position: 2,
    });
  });

  it('a escolha sem escolhida passa a escolher a opção nova', () => {
    const { option, selectedOptionId } = newOptionData(
      row({ selectedOptionId: null, options: [] }),
      { resourceId: 'material:lona' },
      ctx,
    );
    expect(selectedOptionId).toBe(option.id);
    expect(
      newOptionData(row(), { resourceId: 'material:lona-fosca' }, ctx)
        .selectedOptionId,
    ).toBeUndefined();
  });

  it('a linha não fica sem recurso; tirar a escolhida escolhe a primeira', () => {
    expect(message(() => removeOptionData(row(), 'o-1'))).toBe(
      'A linha precisa de ao menos um recurso; remova a linha',
    );
    expect(() => removeOptionData(row(), 'o-9')).toThrow(NotFoundException);

    const two = row({
      options: [
        ...row().options,
        { ...row().options[0], id: 'o-2', position: 1 },
      ],
    });
    expect(removeOptionData(two, 'o-1')).toEqual({ selectedOptionId: 'o-2' });
    expect(removeOptionData(two, 'o-2')).toEqual({
      selectedOptionId: undefined,
    });
  });
});

describe('linhas da composição: campos e motor', () => {
  it('o nome do campo vale sem acento e sem maiúscula', () => {
    const fields = [{ id: 'f-1', name: 'Distância entre ilhoses' }];
    expect(findByName(fields, ' DISTANCIA entre ilhoses ')).toBe(fields[0]);
    expect(findByName(fields, 'Distância')).toBeUndefined();
  });

  it('campo inteiro recusa decimal (IP-19)', () => {
    expect(
      message(() =>
        integerCheck({ name: 'Nº de letras', allowsFraction: false }, 1.5),
      ),
    ).toBe(
      'Nº de letras é um número inteiro. Ligue "Aceita fração" se o campo puder ter decimais',
    );
    expect(() =>
      integerCheck({ name: 'Metros', allowsFraction: true }, 1.5),
    ).not.toThrow();
  });

  it('a opção sem recurso no cadastro sai da linha do motor; a folha vai em metros', () => {
    const engine = toEngineLine(
      row({
        options: [
          { ...row().options[0], resourceId: 'material:couche', minimum: 2 },
          { ...row().options[0], id: 'o-2', resourceId: 'material:inativo' },
        ],
      }),
      RESOURCES,
    );
    expect(engine.options).toHaveLength(1);
    expect(engine.options[0]).toMatchObject({
      id: 'o-1',
      resourceId: 'material:couche',
      sheet: { width: 0.297, height: 0.42, wholeSheets: true },
      minimum: 2,
    });
    expect(engine.options[0]).not.toHaveProperty('perUnit');
  });
});

describe('regras de venda (MS-3 a MS-6)', () => {
  it('depois de outra etapa, o processo que herda usa a medida da base', () => {
    expect(rulesByPosition(BASE_RULES, 'INHERIT', ['b-1'])).toMatchObject({
      dimension: 'SAME_AS_PARENT',
      quantityMode: 'HIDDEN_ONE',
    });
    expect(rulesByPosition(BASE_RULES, 'OWN', ['b-1'])).toEqual(BASE_RULES);
  });

  it('começando um caminho, a regra de acabamento vira medida própria', () => {
    expect(
      rulesByPosition(
        {
          ...BASE_RULES,
          dimension: 'SAME_AS_PARENT',
          quantityMode: 'HIDDEN_ONE',
        },
        'INHERIT',
        [],
      ),
    ).toMatchObject({ dimension: 'FREE_SIZE', quantityMode: 'FREE' });
  });

  it('o JSON gravado é completado pela base; valor estranho é ignorado', () => {
    expect(rulesOf({ quantityMode: 'AREA_RATIO', dimension: 'X' })).toEqual({
      ...BASE_RULES,
      quantityMode: 'AREA_RATIO',
    });
    expect(rulesOf(null)).toEqual(BASE_RULES);
    expect(
      mergeRules(BASE_RULES, { extraField: 'DECIMAL', followsBase: undefined }),
    ).toEqual({ ...BASE_RULES, extraField: 'DECIMAL' });
  });
});
