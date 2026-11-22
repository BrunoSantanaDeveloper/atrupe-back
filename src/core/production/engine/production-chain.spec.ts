import {
  ChainProject,
  ChainTask,
  ProductionChain,
  WorkCalendar,
} from './production-chain';

// Relógio fixo em UTC-3, como São Paulo: quarta, 07/10/2026, 10:00
const at = (date: string, time: string) =>
  new Date(`${date}T${time}:00.000-03:00`);
const dayOf = (instant: Date) =>
  new Date(instant.getTime() - 3 * 3600000).toISOString().slice(0, 10);
const NOW = at('2026-10-07', '10:00');
const clock = { now: NOW, at, dayOf };

const task = (patch: Partial<ChainTask> & { id: string }): ChainTask => ({
  projectId: 'p1',
  stageName: patch.id,
  status: 'NOT_STARTED',
  estimatedMinutes: 60,
  dependsOn: [],
  released: false,
  schedule: null,
  entries: [],
  ...patch,
});

const chainOf = (tasks: ChainTask[], project: Partial<ChainProject> = {}) =>
  new ProductionChain(
    tasks,
    new Map([
      ['p1', { id: 'p1', status: 'PRODUCTION', due: '2026-10-09', ...project }],
    ]),
    clock,
  );

describe('ProductionChain', () => {
  describe('bloqueio (PR-2, FL-13)', () => {
    it('trava a que não começou enquanto a anterior está aberta', () => {
      const base = task({ id: 'impressao' });
      const finish = task({ id: 'acabamento', dependsOn: ['impressao'] });
      const chain = chainOf([base, finish]);
      expect(chain.blocking(finish)).toEqual({
        blocked: true,
        blockedBy: 'impressao',
      });
      expect(chain.blocking(base).blocked).toBe(false);
    });

    it.each(['DONE', 'CANCELED'] as const)('a anterior %s libera', (status) => {
      const chain = chainOf([
        task({ id: 'a', status }),
        task({ id: 'b', dependsOn: ['a'] }),
      ]);
      expect(chain.blocking(chain.task('b')!).blocked).toBe(false);
    });

    it('liberar a próxima antes de concluir libera a dependente', () => {
      const chain = chainOf([
        task({ id: 'a', status: 'IN_PROGRESS', released: true }),
        task({ id: 'b', dependsOn: ['a'] }),
      ]);
      expect(chain.blocking(chain.task('b')!).blocked).toBe(false);
    });

    it('a que já começou não trava, mesmo com a anterior aberta', () => {
      const chain = chainOf([
        task({ id: 'a' }),
        task({ id: 'b', status: 'PAUSED', dependsOn: ['a'] }),
      ]);
      expect(chain.blocking(chain.task('b')!).blocked).toBe(false);
    });

    it('projeto em stand-by trava tudo', () => {
      const chain = chainOf([task({ id: 'a' })], { status: 'STANDBY' });
      expect(chain.blocking(chain.task('a')!)).toEqual({
        blocked: true,
        blockedBy: 'produção não liberada',
      });
    });
  });

  it('o apontado soma os trechos fechados e o que corre, com uma casa', () => {
    const chain = chainOf([
      task({
        id: 'a',
        entries: [
          {
            start: at('2026-10-07', '08:00'),
            end: at('2026-10-07', '08:20'),
            seconds: 1200,
          },
          // Aberto há 25 min e 30 s
          { start: new Date(NOW.getTime() - 1530000), end: null, seconds: 0 },
        ],
      }),
    ]);
    expect(chain.actualMinutes(chain.task('a')!)).toBe(45.5);
  });

  it('atrasada: aberta com a entrega antes de hoje', () => {
    const chain = chainOf(
      [task({ id: 'a' }), task({ id: 'b', status: 'DONE' })],
      { due: '2026-10-06' },
    );
    expect(chain.late(chain.task('a')!)).toBe(true);
    expect(chain.late(chain.task('b')!)).toBe(false);
  });

  describe('alertas da cadeia (§12.2, GP-42)', () => {
    it('OVERDUE: o fim agendado passou', () => {
      const chain = chainOf([
        task({
          id: 'a',
          schedule: { date: '2026-10-07', start: '08:30', minutes: 60 },
        }),
      ]);
      expect(chain.alert(chain.task('a')!)?.kind).toBe('OVERDUE');
    });

    it('sem alerta fora de produção e na tarefa encerrada', () => {
      const overdue = { date: '2026-10-07', start: '08:00', minutes: 30 };
      expect(
        chainOf([task({ id: 'a', schedule: overdue })], {
          status: 'STANDBY',
        }).alert(task({ id: 'a', schedule: overdue })),
      ).toBeNull();
      const chain = chainOf([
        task({ id: 'a', status: 'DONE', schedule: overdue }),
      ]);
      expect(chain.alert(chain.task('a')!)).toBeNull();
    });

    it('LATE_PREDECESSOR em cadeia: a anterior da anterior venceu', () => {
      const chain = chainOf([
        task({
          id: 'impressao',
          schedule: { date: '2026-10-07', start: '08:00', minutes: 60 },
        }),
        task({ id: 'refile', dependsOn: ['impressao'] }),
        task({ id: 'instalacao', dependsOn: ['refile'] }),
      ]);
      expect(chain.alert(chain.task('refile')!)).toEqual({
        kind: 'LATE_PREDECESSOR',
        text: 'impressao atrasou. Esta etapa herda o atraso até a cadeia voltar a ficar alinhada.',
      });
      expect(chain.alert(chain.task('instalacao')!)?.text).toBe(
        'refile atrasou. Esta etapa herda o atraso até a cadeia voltar a ficar alinhada.',
      );
    });

    it('DELIVERY_RISK: o caminho mais longo não cabe no expediente', () => {
      // Até 09/10 às 18:00: hoje 10:00-18:00 (480) + 600 + 600 = 1680 min
      const chain = chainOf([
        task({ id: 'base', estimatedMinutes: 600 }),
        task({ id: 'curto', estimatedMinutes: 100, dependsOn: ['base'] }),
        task({ id: 'longo', estimatedMinutes: 1100, dependsOn: ['base'] }),
      ]);
      expect(chain.workMinutesUntil('2026-10-09')).toBe(1680);
      expect(chain.remainingAhead(chain.task('base')!)).toBe(1700);
      expect(chain.alert(chain.task('base')!)).toEqual({
        kind: 'DELIVERY_RISK',
        text: 'O que falta daqui para a frente (1700 min) não cabe até a entrega em 09/10/2026.',
      });
      // A dependente herda o alerta da anterior (recursivo)
      expect(chain.alert(chain.task('curto')!)?.kind).toBe('LATE_PREDECESSOR');
    });

    it('o apontado desconta do que falta, e o alerta some quando cabe', () => {
      const chain = chainOf([
        task({
          id: 'base',
          status: 'IN_PROGRESS',
          estimatedMinutes: 1700,
          entries: [
            {
              start: at('2026-10-06', '08:00'),
              end: at('2026-10-06', '09:00'),
              seconds: 3600,
            },
          ],
        }),
      ]);
      expect(chain.remainingAhead(chain.task('base')!)).toBe(1640);
      expect(chain.alert(chain.task('base')!)).toBeNull();
    });

    it('DELIVERY_RISK: agendada depois da entrega', () => {
      const chain = chainOf([
        task({
          id: 'a',
          estimatedMinutes: 10,
          schedule: { date: '2026-10-10', start: '08:00', minutes: 10 },
        }),
      ]);
      expect(chain.alert(chain.task('a')!)).toEqual({
        kind: 'DELIVERY_RISK',
        text: 'Agendada para depois da data de entrega.',
      });
    });

    it('a entrega vencida não tem expediente: tudo o que falta é risco', () => {
      const chain = chainOf([task({ id: 'a', estimatedMinutes: 1 })], {
        due: '2026-10-06',
      });
      expect(chain.workMinutesUntil('2026-10-06')).toBe(0);
      expect(chain.alert(chain.task('a')!)?.kind).toBe('DELIVERY_RISK');
    });

    it('dependência em círculo não trava a conta', () => {
      const chain = chainOf([
        task({ id: 'a', dependsOn: ['b'] }),
        task({ id: 'b', dependsOn: ['a'] }),
      ]);
      expect(() => chain.alert(chain.task('a')!)).not.toThrow();
      expect(chain.remainingAhead(chain.task('a')!)).toBeGreaterThan(0);
    });
  });

  describe('o expediente (§4.8)', () => {
    // Sexta, 09/10/2026, 10:00; a entrega na terça, 13/10
    const friday = at('2026-10-09', '10:00');
    const chainAt = (calendar?: WorkCalendar) =>
      new ProductionChain([], new Map(), {
        now: friday,
        at,
        dayOf,
        ...(calendar ? { calendar } : {}),
      });

    it('sem cadastro, o fim de semana não conta', () => {
      // Sexta 480 + segunda 600 + terça 600
      expect(chainAt().workMinutesUntil('2026-10-13')).toBe(1680);
    });

    it('o sábado conta quando a empresa trabalha', () => {
      const calendar = {
        workDays: [1, 2, 3, 4, 5, 6],
        startTime: '08:00',
        endTime: '12:00',
        holidays: [],
      };
      // Sexta 120 + sábado 240 + segunda 240 + terça 240
      expect(chainAt(calendar).workMinutesUntil('2026-10-13')).toBe(840);
    });

    it('o feriado não conta', () => {
      const calendar = {
        workDays: [1, 2, 3, 4, 5],
        startTime: '08:00',
        endTime: '18:00',
        holidays: ['2026-10-12'],
      };
      expect(chainAt(calendar).workMinutesUntil('2026-10-13')).toBe(1080);
    });
  });

  it('o resumo do projeto conta concluídas, alertas, risco e atraso', () => {
    const tasks = [
      task({ id: 'a', status: 'DONE' }),
      task({
        id: 'b',
        schedule: { date: '2026-10-07', start: '08:00', minutes: 30 },
      }),
      task({ id: 'c', estimatedMinutes: 5000 }),
    ];
    const chain = chainOf(tasks);
    expect(chain.projectSummary('p1', tasks)).toEqual({
      total: 3,
      done: 1,
      alerts: 2,
      risk: true,
      late: false,
    });
  });
});

describe('tempo após a conclusão (GP-48 item 21)', () => {
  it('a espera (secagem) entra no caminho até a etapa seguinte', () => {
    const chain = chainOf([
      task({ id: 'impressao', estimatedMinutes: 60, afterDoneMinutes: 30 }),
      task({
        id: 'acabamento',
        estimatedMinutes: 40,
        dependsOn: ['impressao'],
      }),
    ]);
    expect(chain.remainingAhead(chain.task('impressao')!)).toBe(130);
  });

  it('a última etapa não espera nada depois', () => {
    const chain = chainOf([
      task({ id: 'impressao', estimatedMinutes: 60, afterDoneMinutes: 30 }),
    ]);
    expect(chain.remainingAhead(chain.task('impressao')!)).toBe(60);
  });

  it('concluída, a espera já não conta', () => {
    const chain = chainOf([
      task({ id: 'impressao', status: 'DONE', afterDoneMinutes: 30 }),
      task({
        id: 'acabamento',
        estimatedMinutes: 40,
        dependsOn: ['impressao'],
      }),
    ]);
    expect(chain.remainingAhead(chain.task('impressao')!)).toBe(40);
  });
});
