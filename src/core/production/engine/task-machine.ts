import { TaskStatus } from './production-chain';

export type TaskAction =
  | 'START'
  | 'PAUSE'
  | 'RESUME'
  | 'FINISH'
  | 'CANCEL'
  | 'RESTART';

export const TASK_ACTIONS: TaskAction[] = [
  'START',
  'PAUSE',
  'RESUME',
  'FINISH',
  'CANCEL',
  'RESTART',
];

const OPEN: TaskStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'PENDING'];

/** As transições dos seis estados (GP-28). */
export const TRANSITIONS: Record<
  TaskAction,
  { from: TaskStatus[]; verb: string; text: string }
> = {
  START: { from: ['NOT_STARTED'], verb: 'iniciar', text: 'Iniciou a etapa' },
  PAUSE: { from: ['IN_PROGRESS'], verb: 'pausar', text: 'Pausou a etapa' },
  RESUME: {
    from: ['PAUSED', 'PENDING'],
    verb: 'continuar',
    text: 'Continuou a etapa',
  },
  FINISH: { from: OPEN, verb: 'concluir', text: 'Concluiu a etapa' },
  CANCEL: { from: OPEN, verb: 'cancelar', text: 'Cancelou a etapa' },
  RESTART: {
    from: ['DONE', 'CANCELED'],
    verb: 'reiniciar',
    text: 'Reiniciou a etapa',
  },
};

export type MachineInput = {
  status: TaskStatus;
  blocked: boolean;
  blockedBy: string | null;
  /** O nome da etapa atual e a seguinte, quando há */
  stepName: string;
  nextStepName: string | null;
  hasPendency: boolean;
};

export type MachinePlan =
  | { ok: false; message: string }
  | {
      ok: true;
      status: TaskStatus;
      /** A resposta (toast) e o histórico */
      message: string;
      history: string[];
      closeEntries: boolean;
      /** Pode ligar o relógio de quem faz (START/RESUME com timeControl) */
      mayOpenClock: boolean;
      advanceStep: boolean;
      complete: boolean;
      clearCompletion: boolean;
      clearPendency: boolean;
      clearSchedule: boolean;
    };

/**
 * O que a ação faz com a tarefa (GP-28, GP-13, GP-14, GP-36). Iniciar e
 * continuar recusam a etapa bloqueada (PR-2); concluir uma etapa do meio
 * passa para a seguinte, que pode estar noutro gerenciador; concluir a
 * última encerra a tarefa; reiniciar mantém o tempo apontado (GP-44).
 */
export function planAction(
  action: TaskAction,
  task: MachineInput,
): MachinePlan {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(task.status)) {
    return { ok: false, message: `Não dá para ${rule.verb} neste estado` };
  }
  // Concluir a etapa que nem começou também espera a anterior: sem controle
  // de tempo (GP-47) é o único botão, e a fila pulava a ordem (03/11/2026)
  const skipsAhead = action === 'FINISH' && task.status === 'NOT_STARTED';
  if (
    (action === 'START' || action === 'RESUME' || skipsAhead) &&
    task.blocked
  ) {
    return { ok: false, message: `Esta etapa espera ${task.blockedBy}` };
  }
  const base = {
    ok: true as const,
    history: [rule.text],
    closeEntries: false,
    mayOpenClock: false,
    advanceStep: false,
    complete: false,
    clearCompletion: false,
    clearPendency: false,
    clearSchedule: false,
  };
  switch (action) {
    case 'START':
      return {
        ...base,
        status: 'IN_PROGRESS',
        message: rule.text,
        mayOpenClock: true,
      };
    case 'RESUME':
      return {
        ...base,
        status: 'IN_PROGRESS',
        message: rule.text,
        mayOpenClock: true,
        clearPendency: task.hasPendency,
      };
    case 'PAUSE':
      return {
        ...base,
        status: 'PAUSED',
        message: rule.text,
        closeEntries: true,
      };
    case 'CANCEL':
      return {
        ...base,
        status: 'CANCELED',
        message: rule.text,
        closeEntries: true,
      };
    case 'RESTART':
      return {
        ...base,
        status: 'NOT_STARTED',
        message: rule.text,
        history: [`${rule.text} (o tempo apontado foi mantido para correção)`],
        clearCompletion: true,
      };
    case 'FINISH':
      if (task.nextStepName) {
        return {
          ...base,
          status: 'NOT_STARTED',
          message: `Foi para ${task.nextStepName}`,
          history: [
            `Concluiu ${task.stepName} e passou para ${task.nextStepName}`,
          ],
          closeEntries: true,
          advanceStep: true,
          clearSchedule: true,
        };
      }
      return {
        ...base,
        status: 'DONE',
        message: 'Tarefa concluída',
        history: ['Concluiu a tarefa'],
        closeEntries: true,
        complete: true,
        clearPendency: task.hasPendency,
      };
  }
}
