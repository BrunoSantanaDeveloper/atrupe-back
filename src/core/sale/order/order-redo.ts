/**
 * Refazer a O.S. (GP-51; Maicol, 23/11/2026): o que passa da O.S. antiga
 * para a nova. Os itens casam pelo produto (ou material), na ordem,
 * preferindo o item igual (mesma variação e mesmas medidas). A etapa já
 * concluída na antiga só conclui a mesma etapa na nova quando o item é o
 * mesmo produto, na mesma variação e nas mesmas medidas, e a quantidade nova
 * cabe no que foi feito (é menor ou igual). Senão, a etapa fica por fazer e
 * o motivo vai para o histórico dela (revisão de 24/11/2026). O que foi
 * produzido e não cabe na nova (a quantidade diminuiu, o item mudou ou saiu)
 * é o excedente: perda da empresa ou cobrado do cliente.
 */
export type RedoItem = {
  id: string;
  productId: string | null;
  materialId: string | null;
  /** A variação do produto ou do material */
  variationId: string | null;
  /** As medidas do item (largura e altura), quando ele tem */
  width: number | null;
  height: number | null;
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

/** A etapa feita na antiga que não passa para a nova, com o motivo */
export type BlockedTask = { taskId: string; reason: string };

const productOf = (item: RedoItem) =>
  item.productId
    ? `p:${item.productId}`
    : item.materialId
      ? `m:${item.materialId}`
      : `n:${item.name}`;

const sameMeasure = (a: number | null, b: number | null) =>
  Math.abs((a || 0) - (b || 0)) < 1e-6;

const sameMeasures = (a: RedoItem, b: RedoItem) =>
  sameMeasure(a.width, b.width) && sameMeasure(a.height, b.height);

const sameItem = (a: RedoItem, b: RedoItem) =>
  productOf(a) === productOf(b) &&
  (a.variationId ?? null) === (b.variationId ?? null) &&
  sameMeasures(a, b);

/** Por que a etapa feita no item antigo não vale para o novo (ou null). */
export function whyNotCarry(old: RedoItem, next: RedoItem): string | null {
  if ((old.variationId ?? null) !== (next.variationId ?? null)) {
    return 'a variação do item mudou';
  }
  if (!sameMeasures(old, next)) return 'as medidas do item mudaram';
  if (next.quantity > old.quantity) {
    return `a quantidade passou de ${old.quantity} para ${next.quantity}`;
  }
  return null;
}

export function planCarry(
  oldItems: RedoItem[],
  newItems: RedoItem[],
  oldTasks: RedoTask[],
  newTasks: RedoTask[],
) {
  const used = new Set<string>();
  const pairs: { old: RedoItem; next: RedoItem }[] = [];
  const pair = (match: (old: RedoItem, next: RedoItem) => boolean) => {
    for (const next of newItems) {
      if (pairs.some((p) => p.next.id === next.id)) continue;
      const old = oldItems.find(
        (item) => !used.has(item.id) && match(item, next),
      );
      if (!old) continue;
      used.add(old.id);
      pairs.push({ old, next });
    }
  };
  // Primeiro o item igual; depois o mesmo produto, que mudou
  pair(sameItem);
  pair((old, next) => productOf(old) === productOf(next));

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
  const blocked: BlockedTask[] = [];
  const losses: LossItem[] = [];
  for (const { old, next } of pairs) {
    const done = doneOf(old.id);
    if (!done.size) continue;
    const reason = whyNotCarry(old, next);
    for (const task of newTasks) {
      if (
        task.quotationProductId === next.id &&
        task.status === 'NOT_STARTED' &&
        done.has(task.stageKey)
      ) {
        if (reason) blocked.push({ taskId: task.id, reason });
        else carry.push(task.id);
      }
    }
    // O item mudou (variação ou medidas): nada do que foi feito serve. A
    // quantidade maior no mesmo item não tem excedente
    const changed = !sameItem(old, next);
    if (changed || old.quantity > next.quantity) {
      const now = changed ? 0 : next.quantity;
      losses.push({
        item: old.name,
        produced: old.quantity,
        now,
        excess: old.quantity - now,
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
  return { carry, blocked, losses };
}
