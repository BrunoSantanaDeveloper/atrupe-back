import {
  PlanItem,
  PlanStage,
  PlanTaskType,
  measureText,
  planTasks,
} from './production-plan';

const types: PlanTaskType[] = [
  {
    id: 'tt-impressao',
    name: 'Impressão',
    release: 'WITH_BASE',
    firstStepId: 'st-imp',
  },
  {
    id: 'tt-acabamento',
    name: 'Acabamento',
    release: 'AFTER_BASE',
    firstStepId: 'st-acab',
  },
  {
    id: 'tt-servico',
    name: 'Serviço',
    release: 'DONE',
    firstStepId: 'st-serv',
  },
];
const fallback: PlanTaskType = {
  id: 'tt-producao',
  name: 'Produção',
  release: 'AFTER_BASE',
  firstStepId: 'st-prod',
};

const stage = (patch: Partial<PlanStage> & { blockId: string }): PlanStage => ({
  name: patch.blockId,
  sector: 'Produção',
  sectorId: 's-prod',
  taskType: '',
  dependsOn: [],
  baseBlockId: null,
  fields: [],
  note: null,
  setupMinutes: 0,
  lines: [
    {
      kind: 'LABOR',
      name: 'MO',
      resource: 'Mão de obra',
      quantity: 10,
      unit: 'min',
    },
  ],
  ...patch,
});

const item = (
  stages: PlanStage[],
  patch: Partial<PlanItem> = {},
): PlanItem => ({
  itemId: 'i1',
  itemName: 'Banner 440 com bastão',
  itemImage: null,
  measure: { quantity: 3, width: 900, height: 1200 },
  stages,
  ...patch,
});

describe('planTasks', () => {
  it('uma tarefa por etapa, com tempo, máquina, consumo sem custo e medida', () => {
    const [task] = planTasks(
      [
        item([
          stage({
            blockId: 'imp',
            name: 'Impressão',
            sector: 'Impressão',
            sectorId: 's-imp',
            taskType: 'impressão',
            setupMinutes: 10,
            fields: ['Nº de letras: 6'],
            note: 'Cuidado com a cor',
            lines: [
              {
                kind: 'MACHINE',
                name: 'Máquina',
                resource: 'Plotter Roland',
                quantity: 22.4,
                unit: 'min',
              },
              {
                kind: 'MATERIAL',
                name: 'Lona',
                resource: 'Lona 440',
                quantity: 3.24,
                unit: 'm²',
                entries: null,
              },
              {
                kind: 'MATERIAL',
                name: 'Acessórios',
                resource: null,
                quantity: null,
                unit: '',
                entries: [{ name: 'Ilhós', quantity: 12, unit: 'un' }],
              },
            ],
          }),
        ]),
      ],
      types,
      fallback,
    );
    expect(task).toEqual({
      key: 'i1:imp',
      stageKey: 'imp',
      itemId: 'i1',
      itemName: 'Banner 440 com bastão',
      itemImage: null,
      stageName: 'Impressão',
      sectorId: 's-imp',
      sectorName: 'Impressão',
      taskTypeId: 'tt-impressao',
      currentStepId: 'st-imp',
      estimatedMinutes: 32,
      setupMinutes: 10,
      machine: 'Plotter Roland',
      baseKey: null,
      dependsOnKeys: [],
      quantity: 3,
      measureText: '3 un · 0,9 × 1,2 m',
      fields: ['Nº de letras: 6'],
      consumption: [
        {
          kind: 'MACHINE',
          resource: 'Plotter Roland',
          quantity: 22.4,
          unit: 'min',
        },
        { kind: 'MATERIAL', resource: 'Lona 440', quantity: 3.24, unit: 'm²' },
        { kind: 'MATERIAL', resource: 'Ilhós', quantity: 12, unit: 'un' },
      ],
      note: 'Cuidado com a cor',
    });
  });

  it('sem tipo com o nome da etapa, cai no padrão', () => {
    const [task] = planTasks(
      [item([stage({ blockId: 'a', taskType: 'Solda' })])],
      types,
      fallback,
    );
    expect(task.taskTypeId).toBe('tt-producao');
    expect(task.currentStepId).toBe('st-prod');
  });

  describe('dependências do fluxo e a regra do tipo (FL-1, GP-13)', () => {
    const base = stage({ blockId: 'imp', taskType: 'Impressão' });

    it('AFTER_BASE espera a base', () => {
      const tasks = planTasks(
        [
          item([
            base,
            stage({
              blockId: 'acab',
              taskType: 'Acabamento',
              dependsOn: ['imp'],
              baseBlockId: 'imp',
            }),
          ]),
        ],
        types,
        fallback,
      );
      expect(tasks[1].dependsOnKeys).toEqual(['i1:imp']);
      expect(tasks[1].baseKey).toBe('i1:imp');
    });

    it('WITH_BASE corre junto com a base, mas mantém o resto do fluxo', () => {
      const tasks = planTasks(
        [
          item([
            base,
            stage({
              blockId: 'corte',
              taskType: 'Acabamento',
              dependsOn: ['imp'],
            }),
            stage({
              blockId: 'aplic',
              taskType: 'Impressão',
              dependsOn: ['imp', 'corte'],
              baseBlockId: 'imp',
            }),
          ]),
        ],
        types,
        fallback,
      );
      expect(tasks[2].dependsOnKeys).toEqual(['i1:corte']);
    });

    it('a etapa vazia não vira tarefa e passa adiante as dependências dela', () => {
      const tasks = planTasks(
        [
          item([
            base,
            stage({
              blockId: 'verniz',
              dependsOn: ['imp'],
              lines: [],
              setupMinutes: 0,
            }),
            stage({
              blockId: 'instal',
              taskType: 'Acabamento',
              dependsOn: ['verniz'],
            }),
          ]),
        ],
        types,
        fallback,
      );
      expect(tasks.map((task) => task.key)).toEqual(['i1:imp', 'i1:instal']);
      expect(tasks[1].dependsOnKeys).toEqual(['i1:imp']);
    });

    it('a etapa só com preparo vira tarefa', () => {
      const tasks = planTasks(
        [item([stage({ blockId: 'setup', lines: [], setupMinutes: 15 })])],
        types,
        fallback,
      );
      expect(tasks[0].estimatedMinutes).toBe(15);
    });

    it('os itens correm em paralelo: nada liga um item ao outro', () => {
      const tasks = planTasks(
        [
          item([base]),
          item(
            [
              stage({
                blockId: 'acab',
                taskType: 'Acabamento',
                dependsOn: ['imp'],
              }),
            ],
            {
              itemId: 'i2',
            },
          ),
        ],
        types,
        fallback,
      );
      expect(tasks[1].dependsOnKeys).toEqual([]);
    });
  });

  describe('a parte vira as caixas de dentro dela (FL-10)', () => {
    const serralheria = { sector: 'Serralheria', sectorId: 's-serr' };
    const parte = stage({
      blockId: 'parte',
      name: 'Estrutura',
      dependsOn: ['imp'],
      // As linhas somadas da parte não viram tarefa
      setupMinutes: 30,
      parts: [
        stage({ blockId: 'corte', name: 'Corte', ...serralheria }),
        stage({
          blockId: 'solda',
          name: 'Solda',
          dependsOn: ['corte'],
          ...serralheria,
        }),
        stage({
          blockId: 'pintura',
          name: 'Pintura',
          sector: 'Pintura',
          sectorId: 's-pint',
          dependsOn: ['solda'],
        }),
      ],
    });

    it('uma tarefa por caixa, no setor dela, ligada ao fluxo do item', () => {
      const tasks = planTasks(
        [
          item([
            stage({ blockId: 'imp' }),
            parte,
            stage({ blockId: 'inst', dependsOn: ['parte'] }),
          ]),
        ],
        types,
        fallback,
      );
      expect(
        tasks.map((task) => [
          task.key,
          task.stageName,
          task.sectorId,
          task.dependsOnKeys,
        ]),
      ).toEqual([
        ['i1:imp', 'imp', 's-prod', []],
        ['i1:parte/corte', 'Estrutura · Corte', 's-serr', ['i1:imp']],
        ['i1:parte/solda', 'Estrutura · Solda', 's-serr', ['i1:parte/corte']],
        [
          'i1:parte/pintura',
          'Estrutura · Pintura',
          's-pint',
          ['i1:parte/solda'],
        ],
        ['i1:inst', 'inst', 's-prod', ['i1:parte/pintura']],
      ]);
      expect(tasks.map((task) => task.stageKey)).toContain('parte/solda');
    });

    it('parte dentro de parte também abre; sem caixas, a parte é uma tarefa', () => {
      const nested = planTasks(
        [
          item([
            stage({
              blockId: 'parte',
              name: 'Estrutura',
              parts: [
                stage({
                  blockId: 'quadro',
                  name: 'Quadro',
                  parts: [stage({ blockId: 'tubo', name: 'Tubo' })],
                }),
                stage({ blockId: 'tela', name: 'Tela', dependsOn: ['quadro'] }),
              ],
            }),
          ]),
        ],
        types,
        fallback,
      );
      expect(
        nested.map((task) => [task.key, task.stageName, task.dependsOnKeys]),
      ).toEqual([
        ['i1:parte/quadro/tubo', 'Estrutura · Quadro · Tubo', []],
        ['i1:parte/tela', 'Estrutura · Tela', ['i1:parte/quadro/tubo']],
      ]);
      // O retrato antigo (sem as caixas) segue com a parte numa tarefa só
      const old = planTasks(
        [item([{ ...parte, parts: null, dependsOn: [] }])],
        types,
        fallback,
      );
      expect(old.map((task) => task.key)).toEqual(['i1:parte']);
    });
  });

  it('a medida sem largura e altura fica só com a quantidade', () => {
    expect(measureText({ quantity: 1000, width: null, height: null })).toBe(
      '1000 un',
    );
  });
});
