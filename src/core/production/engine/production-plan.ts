/**
 * As tarefas do projeto, a partir do retrato da composição de cada item
 * vendido (ORC-10, PCP-4, FL-10, GP-16): uma por etapa, com o tempo vendido,
 * o consumo resolvido na medida da venda (sem custo nem preço, ORC-7) e as
 * dependências do fluxo dentro do item (FL-1), ajustadas pela regra do tipo
 * de tarefa (GP-13). Os itens correm em paralelo (§4.7).
 *
 * Pura: os tipos de tarefa e o código curto vêm de fora.
 */

export type PlanLine = {
  kind?: string;
  name?: string;
  resource?: string | null;
  /** `machine:<configuração>`, `machine-group:<grupo>`, `material:…` */
  resourceId?: string | null;
  quantity?: number | null;
  unit?: string;
  entries?:
    | {
        name?: string;
        resourceId?: string | null;
        quantity?: number | null;
        unit?: string;
      }[]
    | null;
};

/**
 * A qualidade (configuração) da máquina, com o tempo por unidade: o
 * cadastro do bem (AssetSetup, vindo do legado).
 */
export type PlanMachineSetup = {
  id: string;
  name: string;
  assetName: string;
  groupId: string | null;
  /** O símbolo da unidade da configuração (m², m, un, h…) */
  unit: string;
  /** Minutos por unidade */
  timePerUnit: number;
};

export type PlanStage = {
  blockId: string;
  name: string;
  sector: string;
  sectorId: string | null;
  taskType: string;
  /** As etapas de que esta depende (FL-1); nulo no retrato antigo */
  dependsOn: string[];
  baseBlockId: string | null;
  fields: string[];
  note: string | null;
  setupMinutes: number;
  lines: PlanLine[];
  /** As caixas de dentro da parte (FL-10); nulo na etapa comum */
  parts?: PlanStage[] | null;
};

export type PlanItem = {
  itemId: string;
  itemName: string;
  itemImage: string | null;
  measure: { quantity: number; width: number | null; height: number | null };
  stages: PlanStage[];
};

export type PlanTaskType = {
  id: string;
  name: string;
  release: 'AFTER_BASE' | 'WITH_BASE' | 'DONE';
  firstStepId: string | null;
};

export type PlannedTask = {
  key: string;
  /** A etapa de origem no item: o bloco, ou line:<id> */
  stageKey: string;
  itemId: string;
  itemName: string;
  itemImage: string | null;
  stageName: string;
  sectorId: string | null;
  sectorName: string;
  taskTypeId: string;
  currentStepId: string | null;
  estimatedMinutes: number;
  setupMinutes: number;
  machine: string | null;
  /** A qualidade vendida (GP-48 item 22): a configuração da máquina */
  machineSetupId: string | null;
  machineQuality: string | null;
  /** Chaves (não ids): o serviço troca pelos ids gravados */
  baseKey: string | null;
  dependsOnKeys: string[];
  quantity: number;
  measureText: string;
  fields: string[];
  consumption: {
    kind: string;
    resource: string;
    quantity: number | null;
    unit: string;
  }[];
  note: string | null;
};

const br = (value: number) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** "3 un · 0,9 × 1,2 m": a medida chega em milímetros. */
export const measureText = (measure: PlanItem['measure']) =>
  [
    `${measure.quantity} un`,
    measure.width && measure.height
      ? `${br(measure.width / 1000)} × ${br(measure.height / 1000)} m`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

const key = (name: string) => name.trim().toLocaleLowerCase('pt-BR');

// O tempo da linha em minutos; fora de unidade de tempo, nulo
const timeOf = (quantity: number, unit: string | undefined) =>
  unit === 'min' ? quantity : unit === 'h' ? quantity * 60 : null;

const prefixed = (resourceId: string | null | undefined) => {
  const at = (resourceId ?? '').indexOf(':');
  return at < 0
    ? ['', '']
    : [resourceId!.slice(0, at), resourceId!.slice(at + 1)];
};

/**
 * A máquina vendida na linha: a configuração (`machine:<id>`) ou, no grupo
 * de máquinas, a média das configurações do grupo na mesma unidade.
 */
const machineOf = (
  resourceId: string | null | undefined,
  unit: string | undefined,
  setups: PlanMachineSetup[],
): { setup: PlanMachineSetup | null; timePerUnit: number } | null => {
  const [prefix, id] = prefixed(resourceId);
  if (prefix === 'machine') {
    const setup = setups.find((item) => item.id === id);
    return setup ? { setup, timePerUnit: setup.timePerUnit } : null;
  }
  if (prefix === 'machine-group') {
    const same = setups.filter(
      (item) => item.groupId === id && item.unit === unit && item.timePerUnit,
    );
    if (!same.length) return null;
    return {
      setup: null,
      timePerUnit:
        same.reduce((sum, item) => sum + item.timePerUnit, 0) / same.length,
    };
  }
  return null;
};

/**
 * O tempo vendido da etapa, sem o preparo (CP-15, GP-48 item 22): as linhas
 * em tempo (min ou h) e a linha de máquina vendida em outra unidade (m², m,
 * un…), que vira minutos pelo tempo por unidade da qualidade vendida. Sem a
 * qualidade ou sem o tempo por unidade, a linha não soma tempo.
 */
export const soldMinutes = (
  lines: PlanLine[],
  setups: PlanMachineSetup[] = [],
) =>
  lines.reduce((sum, line) => {
    const quantity = Number(line.quantity) || 0;
    const time = timeOf(quantity, line.unit);
    if (time !== null) return sum + time;
    if (line.kind !== 'MACHINE') return sum;
    const uses = line.entries?.length
      ? line.entries.map((entry) => ({
          resourceId: entry.resourceId ?? line.resourceId,
          quantity: Number(entry.quantity) || 0,
          unit: entry.unit ?? line.unit,
        }))
      : [{ resourceId: line.resourceId, quantity, unit: line.unit }];
    return (
      sum +
      uses.reduce((total, use) => {
        const machine = machineOf(use.resourceId, use.unit, setups);
        return total + (machine ? use.quantity * machine.timePerUnit : 0);
      }, 0)
    );
  }, 0);

/** A qualidade vendida: a configuração da primeira linha de máquina. */
const qualityOf = (lines: PlanLine[], setups: PlanMachineSetup[]) => {
  for (const line of lines.filter((item) => item.kind === 'MACHINE')) {
    const ids = [
      line.resourceId,
      ...(line.entries ?? []).map((entry) => entry.resourceId),
    ];
    for (const id of ids) {
      const setup = machineOf(id, line.unit, setups)?.setup;
      if (setup) return setup;
    }
  }
  return null;
};

const consumptionOf = (lines: PlanLine[]) =>
  lines.flatMap((line) =>
    line.entries?.length
      ? line.entries.map((entry) => ({
          kind: line.kind ?? '',
          resource: entry.name ?? '',
          quantity: entry.quantity ?? null,
          unit: entry.unit ?? '',
        }))
      : [
          {
            kind: line.kind ?? '',
            resource: line.resource || line.name || '',
            quantity: line.quantity ?? null,
            unit: line.unit ?? '',
          },
        ],
  );

/**
 * O tipo da etapa: o ativo com o mesmo nome, sem diferenciar maiúsculas
 * (IP-23); sem ele, o padrão.
 */
export const typeFor = (
  stage: { taskType: string },
  types: PlanTaskType[],
  fallback: PlanTaskType,
) =>
  types.find((type) => key(type.name) === key(stage.taskType || '')) ??
  fallback;

/**
 * A parte vira as caixas de dentro dela (FL-10): cada uma é uma etapa no
 * setor dela, com o fluxo de dentro da parte e o nome "Parte · Caixa". Duas
 * etapas vazias fazem a ligação com o fluxo do item: a entrada (o que a
 * parte esperava) e a saída (as últimas de dentro), que não viram tarefa e
 * passam adiante as dependências.
 */
export const expandParts = (
  stages: PlanStage[],
  prefix = '',
  entry: string | null = null,
  namePrefix = '',
): PlanStage[] =>
  stages.flatMap((stage) => {
    const id = prefix + stage.blockId;
    const dependsOn = stage.dependsOn.length
      ? stage.dependsOn.map((dep) => prefix + dep)
      : entry
        ? [entry]
        : [];
    const baseBlockId = stage.baseBlockId ? prefix + stage.baseBlockId : null;
    const name = namePrefix + stage.name;
    if (!stage.parts?.length) {
      return [{ ...stage, blockId: id, name, dependsOn, baseBlockId }];
    }
    const inside = `${id}/`;
    const used = new Set(stage.parts.flatMap((part) => part.dependsOn));
    const exits = stage.parts
      .filter((part) => !used.has(part.blockId))
      .map((part) => inside + part.blockId);
    const hollow = { ...stage, lines: [], setupMinutes: 0, parts: null };
    return [
      { ...hollow, blockId: `${id}>`, dependsOn, baseBlockId },
      ...expandParts(stage.parts, inside, `${id}>`, `${name} · `),
      { ...hollow, blockId: id, dependsOn: exits, baseBlockId: null },
    ];
  });

export function planTasks(
  items: PlanItem[],
  types: PlanTaskType[],
  fallback: PlanTaskType,
  setups: PlanMachineSetup[] = [],
  /**
   * PRO (GP-49): o tipo vem do setor da etapa (cada ícone é uma tela de
   * setor); sem resposta, vale o tipo pelo nome
   */
  bySector?: (stage: PlanStage) => PlanTaskType | undefined,
): PlannedTask[] {
  const planned: PlannedTask[] = [];
  for (const item of items) {
    const itemStages = expandParts(item.stages);
    const stages = new Map(itemStages.map((stage) => [stage.blockId, stage]));
    // A etapa vazia nesta venda (a opcional desmarcada) não vira tarefa
    const kept = new Set(
      itemStages
        .filter((stage) => stage.lines.length || stage.setupMinutes > 0)
        .map((stage) => stage.blockId),
    );
    const keyOf = (blockId: string) => `${item.itemId}:${blockId}`;
    // A dependência que não virou tarefa passa adiante as dela
    const resolve = (blockId: string, seen = new Set<string>()): string[] => {
      if (seen.has(blockId)) return [];
      seen.add(blockId);
      if (kept.has(blockId)) return [keyOf(blockId)];
      const stage = stages.get(blockId);
      if (!stage) return [];
      return [...new Set(stage.dependsOn.flatMap((id) => resolve(id, seen)))];
    };

    for (const stage of itemStages) {
      if (!kept.has(stage.blockId)) continue;
      const type = bySector?.(stage) ?? typeFor(stage, types, fallback);
      const quality = qualityOf(stage.lines, setups);
      const flow = [...new Set(stage.dependsOn.flatMap((id) => resolve(id)))];
      const base = stage.baseBlockId ? resolve(stage.baseBlockId) : [];
      // A regra do tipo ajusta a ligação com a base: o acabamento espera a
      // base, ou corre junto com ela (GP-13)
      const dependsOnKeys =
        type.release === 'WITH_BASE'
          ? flow.filter((id) => !base.includes(id))
          : type.release === 'AFTER_BASE'
            ? [...new Set([...flow, ...base])]
            : flow;
      planned.push({
        key: keyOf(stage.blockId),
        stageKey: stage.blockId,
        itemId: item.itemId,
        itemName: item.itemName,
        itemImage: item.itemImage,
        stageName: stage.name,
        sectorId: stage.sectorId,
        sectorName: stage.sector,
        taskTypeId: type.id,
        currentStepId: type.firstStepId,
        estimatedMinutes: Math.round(
          stage.setupMinutes + soldMinutes(stage.lines, setups),
        ),
        setupMinutes: Math.round(stage.setupMinutes),
        machine:
          stage.lines.find((line) => line.kind === 'MACHINE')?.resource ?? null,
        machineSetupId: quality?.id ?? null,
        machineQuality: quality?.name ?? null,
        baseKey: base[0] ?? null,
        dependsOnKeys: dependsOnKeys.filter(
          (id) => id !== keyOf(stage.blockId),
        ),
        quantity: item.measure.quantity,
        measureText: measureText(item.measure),
        fields: stage.fields,
        consumption: consumptionOf(stage.lines),
        note: stage.note,
      });
    }
  }
  return planned;
}

/** Os setores das etapas, com as caixas das partes (FL-10). */
export const stageSectors = (stages: PlanStage[]): Map<string, string> => {
  const sectors = new Map<string, string>();
  const walk = (list: PlanStage[]) => {
    for (const stage of list) {
      if (stage.sectorId && !sectors.has(stage.sectorId)) {
        sectors.set(stage.sectorId, stage.sector);
      }
      if (stage.parts?.length) walk(stage.parts);
    }
  };
  walk(stages);
  return sectors;
};
