/**
 * A Agenda de entrega por item (área 9 §4.7; Maicol, 23/11/2026): a etapa do
 * pedido de um setor é o resumo das etapas dos itens nesse setor. Os estados
 * são os da GP-28, e a leitura é a mesma em todos os planos: o que está em
 * produção, o que falta, o que está pronto e o que está parado.
 *
 * - algum item com pendência → com pendência (o parado por problema);
 * - senão, algum em andamento → em andamento; algum pausado → pausado;
 * - todos finalizados ou cancelados → finalizado; todos cancelados → cancelado;
 * - nenhum começou → não iniciado;
 * - uns prontos e outros por começar → em andamento (o setor já começou).
 */
export type StageStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'PENDING'
  | 'DONE'
  | 'CANCELED'
  | 'WAITING_PRODUCTION'
  | 'OVERDUE';

export const CLOSED: readonly StageStatus[] = ['DONE', 'CANCELED'];

export function aggregateStatus(statuses: StageStatus[]): StageStatus {
  if (!statuses.length) return 'NOT_STARTED';
  if (statuses.includes('PENDING')) return 'PENDING';
  if (statuses.includes('IN_PROGRESS')) return 'IN_PROGRESS';
  if (statuses.includes('PAUSED')) return 'PAUSED';
  if (statuses.every((status) => CLOSED.includes(status))) {
    return statuses.every((status) => status === 'CANCELED')
      ? 'CANCELED'
      : 'DONE';
  }
  if (statuses.every((status) => status === 'NOT_STARTED')) {
    return 'NOT_STARTED';
  }
  return 'IN_PROGRESS';
}

/**
 * Quais itens recebem a ação feita na etapa do pedido (LITE: concluir pelo
 * pedido conclui o setor em todos os itens). Reiniciar volta todos; as outras
 * ações valem só para os itens ainda abertos.
 */
export function itemsToApply<T extends { status: StageStatus }>(
  items: T[],
  next: StageStatus,
): T[] {
  if (next === 'NOT_STARTED') return items;
  return items.filter((item) => !CLOSED.includes(item.status));
}
