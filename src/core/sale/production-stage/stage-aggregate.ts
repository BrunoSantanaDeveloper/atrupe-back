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

export const STAGE_STATUSES: readonly StageStatus[] = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'PAUSED',
  'PENDING',
  'DONE',
  'CANCELED',
  'WAITING_PRODUCTION',
  'OVERDUE',
];

/** Os estados abertos: o que "Concluir tudo" finaliza */
export const OPEN: readonly StageStatus[] = STAGE_STATUSES.filter(
  (status) => !CLOSED.includes(status),
);

/** Para onde se continua depois da pausa */
const WORKING: readonly StageStatus[] = ['NOT_STARTED', 'IN_PROGRESS'];

export type ItemStage = {
  id: string;
  status: StageStatus;
  prevStatus?: string | null;
};

export type ItemChange = {
  id: string;
  status: StageStatus;
  prevStatus: StageStatus;
};

/** O estado anterior do item, quando ele serve para a volta; senão, next */
const previousOf = (
  item: ItemStage,
  fits: (status: StageStatus) => boolean,
  next: StageStatus,
) => {
  const prev = item.prevStatus as StageStatus | null | undefined;
  return prev && STAGE_STATUSES.includes(prev) && fits(prev) ? prev : next;
};

/**
 * Como a ação feita na etapa do pedido chega aos itens do setor (LITE:
 * concluir pelo pedido conclui o setor em todos os itens). Cada item guarda o
 * próprio estado anterior (revisão de 24/11/2026):
 * - tirar a pendência (o pedido sai de pendente para um estado aberto): cada
 *   item pendente volta ao próprio estado anterior, se ele era aberto; os
 *   outros ficam como estão;
 * - continuar (o pedido sai de pausado para não iniciado ou em andamento):
 *   cada item pausado volta ao que fazia (não iniciado ou em andamento);
 * - reiniciar (não iniciado) volta todos;
 * - voltar o pedido fechado (finalizado ou cancelado) para um estado aberto
 *   reabre os itens daquela etapa que estavam como o pedido (os finalizados,
 *   ou os cancelados; sem nenhum, os fechados);
 * - as outras ações valem só para os itens ainda abertos.
 * O item que já está no estado pedido fica como está (guarda o anterior).
 */
export function itemChanges(
  items: ItemStage[],
  from: StageStatus,
  next: StageStatus,
): ItemChange[] {
  const change = (item: ItemStage, status: StageStatus): ItemChange => ({
    id: item.id,
    status,
    prevStatus: item.status,
  });
  if (from === next) return [];
  if (from === 'PENDING' && !CLOSED.includes(next)) {
    const fits = (status: StageStatus) =>
      status !== 'PENDING' && !CLOSED.includes(status);
    return items
      .filter((item) => item.status === 'PENDING')
      .map((item) => change(item, previousOf(item, fits, next)));
  }
  if (from === 'PAUSED' && WORKING.includes(next)) {
    const fits = (status: StageStatus) => WORKING.includes(status);
    return items
      .filter((item) => item.status === 'PAUSED')
      .map((item) => change(item, previousOf(item, fits, next)));
  }
  if (next === 'NOT_STARTED') {
    return items
      .filter((item) => item.status !== next)
      .map((item) => change(item, next));
  }
  if (CLOSED.includes(from) && !CLOSED.includes(next)) {
    const same = items.filter((item) => item.status === from);
    const reopen = same.length
      ? same
      : items.filter((item) => CLOSED.includes(item.status));
    return reopen.map((item) => change(item, next));
  }
  return items
    .filter((item) => !CLOSED.includes(item.status) && item.status !== next)
    .map((item) => change(item, next));
}

/**
 * A etapa do pedido depois de uma troca: o resumo dos itens. Cancelar pelo
 * pedido fica cancelado mesmo com algum item já finalizado: o item feito
 * segue finalizado (o que foi feito não se apaga), e o resumo diria
 * "finalizado", desfazendo o que a pessoa pediu. Fora isso, finalizados e
 * cancelados juntos dão finalizado: o setor terminou o que tinha a fazer.
 */
export function orderStatusAfter(
  statuses: StageStatus[],
  action?: StageStatus,
): StageStatus {
  const status = aggregateStatus(statuses);
  return action === 'CANCELED' && status === 'DONE' ? 'CANCELED' : status;
}
