import { TaskStatus } from './production-chain';
import { TASK_ACTIONS, TaskAction, planAction } from './task-machine';

const STATUSES: TaskStatus[] = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'PAUSED',
  'PENDING',
  'DONE',
  'CANCELED',
];

const input = (status: TaskStatus, patch = {}) => ({
  status,
  blocked: false,
  blockedBy: null,
  stepName: 'Impressão',
  nextStepName: null,
  hasPendency: false,
  ...patch,
});

// O resultado de cada ação em cada estado (GP-28); null = recusa
const EXPECTED: Record<TaskStatus, Record<TaskAction, TaskStatus | null>> = {
  NOT_STARTED: {
    START: 'IN_PROGRESS',
    PAUSE: null,
    RESUME: null,
    FINISH: 'DONE',
    CANCEL: 'CANCELED',
    RESTART: null,
  },
  IN_PROGRESS: {
    START: null,
    PAUSE: 'PAUSED',
    RESUME: null,
    FINISH: 'DONE',
    CANCEL: 'CANCELED',
    RESTART: null,
  },
  PAUSED: {
    START: null,
    PAUSE: null,
    RESUME: 'IN_PROGRESS',
    FINISH: 'DONE',
    CANCEL: 'CANCELED',
    RESTART: null,
  },
  PENDING: {
    START: null,
    PAUSE: null,
    RESUME: 'IN_PROGRESS',
    FINISH: 'DONE',
    CANCEL: 'CANCELED',
    RESTART: null,
  },
  DONE: {
    START: null,
    PAUSE: null,
    RESUME: null,
    FINISH: null,
    CANCEL: null,
    RESTART: 'NOT_STARTED',
  },
  CANCELED: {
    START: null,
    PAUSE: null,
    RESUME: null,
    FINISH: null,
    CANCEL: null,
    RESTART: 'NOT_STARTED',
  },
};

describe('planAction: 6 estados × 6 ações (GP-28)', () => {
  for (const status of STATUSES) {
    for (const action of TASK_ACTIONS) {
      const expected = EXPECTED[status][action];
      it(`${action} em ${status} → ${expected ?? 'recusa'}`, () => {
        const plan = planAction(action, input(status));
        if (expected === null) {
          expect(plan.ok).toBe(false);
          expect(!plan.ok && plan.message).toMatch(
            /^Não dá para \S+ neste estado$/,
          );
        } else {
          expect(plan.ok && plan.status).toBe(expected);
        }
      });
    }
  }

  it.each(['START', 'RESUME'] as const)(
    '%s recusa a etapa bloqueada (PR-2)',
    (action) => {
      const status = action === 'START' ? 'NOT_STARTED' : 'PAUSED';
      const plan = planAction(
        action,
        input(status, { blocked: true, blockedBy: 'Impressão' }),
      );
      expect(plan).toEqual({
        ok: false,
        message: 'Esta etapa espera Impressão',
      });
    },
  );

  it('FINISH recusa a etapa bloqueada que nem começou', () => {
    const plan = planAction(
      'FINISH',
      input('NOT_STARTED', { blocked: true, blockedBy: 'Corte CNC' }),
    );
    expect(plan).toEqual({
      ok: false,
      message: 'Esta etapa espera Corte CNC',
    });
  });

  it('FINISH conclui a etapa já começada mesmo bloqueada depois', () => {
    const plan = planAction(
      'FINISH',
      input('IN_PROGRESS', { blocked: true, blockedBy: 'Corte CNC' }),
    );
    expect(plan.ok && plan.status).toBe('DONE');
  });

  it('concluir uma etapa do meio passa para a seguinte, sem agenda (GP-14)', () => {
    const plan = planAction(
      'FINISH',
      input('IN_PROGRESS', { nextStepName: 'Refile' }),
    );
    expect(plan).toMatchObject({
      ok: true,
      status: 'NOT_STARTED',
      message: 'Foi para Refile',
      history: ['Concluiu Impressão e passou para Refile'],
      advanceStep: true,
      clearSchedule: true,
      closeEntries: true,
      complete: false,
    });
  });

  it('concluir a última encerra e registra quem concluiu (GP-36)', () => {
    expect(
      planAction('FINISH', input('PENDING', { hasPendency: true })),
    ).toMatchObject({
      status: 'DONE',
      message: 'Tarefa concluída',
      complete: true,
      clearPendency: true,
    });
  });

  it('reiniciar mantém o apontado e limpa a conclusão (GP-44)', () => {
    expect(planAction('RESTART', input('DONE'))).toMatchObject({
      status: 'NOT_STARTED',
      clearCompletion: true,
      closeEntries: false,
      history: [
        'Reiniciou a etapa (o tempo apontado foi mantido para correção)',
      ],
    });
  });

  it('continuar resolve a pendência', () => {
    expect(
      planAction('RESUME', input('PENDING', { hasPendency: true })),
    ).toMatchObject({
      status: 'IN_PROGRESS',
      clearPendency: true,
      mayOpenClock: true,
    });
  });

  it.each(['PAUSE', 'CANCEL'] as const)(
    '%s fecha os trechos abertos',
    (action) => {
      const plan = planAction(action, input('IN_PROGRESS'));
      expect(plan.ok && plan.closeEntries).toBe(true);
    },
  );
});
