/**
 * Refazer a O.S. (GP-51; Maicol, 23/11/2026): o que passa da O.S. antiga
 * para a nova. Os itens casam pelo produto (ou material), na ordem; num par,
 * a etapa já concluída na antiga conclui a mesma etapa na nova. O que foi
 * produzido e não cabe na nova (a quantidade diminuiu, ou o item saiu) é o
 * excedente: perda da empresa ou cobrado do cliente.
 */
export type RedoItem = {
  id: string;
  productId: string | null;
  materialId: string | null;
  quantity: number;
  name: string;
};

export type RedoTask = {
  id: string;
  quotationProductId: string | null;
  stageKey: string;
  status: string;
};

export type LossItem = {
  item: string;
  produced: number;
  now: number;
  excess: number;
};

const keyOf = (item: RedoItem) =>
  item.productId
    ? `p:${item.productId}`
    : item.materialId
      ? `m:${item.materialId}`
      : `n:${item.name}`;

export function planCarry(
  oldItems: RedoItem[],
  newItems: RedoItem[],
  oldTasks: RedoTask[],
  newTasks: RedoTask[],
) {
  const used = new Set<string>();
  const pairs: { old: RedoItem; next: RedoItem }[] = [];
  for (const next of newItems) {
    const old = oldItems.find(
      (item) => !used.has(item.id) && keyOf(item) === keyOf(next),
    );
    if (!old) continue;
    used.add(old.id);
    pairs.push({ old, next });
  }
  const doneOf = (itemId: string) =>
    new Set(
      oldTasks
        .filter(
          (task) =>
            task.quotationProductId === itemId && task.status === 'DONE',
        )
        .map((task) => task.stageKey),
    );
  const carry: string[] = [];
  const losses: LossItem[] = [];
  for (const { old, next } of pairs) {
    const done = doneOf(old.id);
    if (!done.size) continue;
    for (const task of newTasks) {
      if (
        task.quotationProductId === next.id &&
        task.status === 'NOT_STARTED' &&
        done.has(task.stageKey)
      ) {
        carry.push(task.id);
      }
    }
    if (old.quantity > next.quantity) {
      losses.push({
        item: old.name,
        produced: old.quantity,
        now: next.quantity,
        excess: old.quantity - next.quantity,
      });
    }
  }
  // O item que saiu da O.S. com etapa já feita: tudo é excedente
  for (const old of oldItems) {
    if (used.has(old.id) || !doneOf(old.id).size) continue;
    losses.push({
      item: old.name,
      produced: old.quantity,
      now: 0,
      excess: old.quantity,
    });
  }
  return { carry, losses };
}
