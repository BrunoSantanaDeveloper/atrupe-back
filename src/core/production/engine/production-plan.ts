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
  quantity?: number | null;
  unit?: string;
  entries?: { name?: string; quantity?: number | null; unit?: string }[] | null;
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

/** O tempo vendido da etapa: o preparo mais as linhas em minutos (CP-15). */
const laborMinutes = (lines: PlanLine[]) =>
  lines
    .filter((line) => line.unit === 'min')
    .reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);

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

export function planTasks(
  items: PlanItem[],
  types: PlanTaskType[],
  fallback: PlanTaskType,
): PlannedTask[] {
  const planned: PlannedTask[] = [];
  for (const item of items) {
    const stages = new Map(item.stages.map((stage) => [stage.blockId, stage]));
    // A etapa vazia nesta venda (a opcional desmarcada) não vira tarefa
    const kept = new Set(
      item.stages
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

    for (const stage of item.stages) {
      if (!kept.has(stage.blockId)) continue;
      const type = typeFor(stage, types, fallback);
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
          stage.setupMinutes + laborMinutes(stage.lines),
        ),
        setupMinutes: Math.round(stage.setupMinutes),
        machine:
          stage.lines.find((line) => line.kind === 'MACHINE')?.resource ?? null,
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
