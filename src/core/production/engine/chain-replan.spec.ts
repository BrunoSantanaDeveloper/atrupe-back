import { momentOf, replan, ReplanTask, WorkClock } from './chain-replan';

const DAY = '2026-11-25'; // quarta-feira
const NEXT = '2026-11-26';
const calendar = { workDays: [1, 2, 3, 4, 5], holidays: [] };
const hours = {
  workStart: '08:00',
  workEnd: '18:00',
  breakStart: '12:00',
  breakEnd: '13:00',
  runsThroughBreak: false,
};

const task = (over: Partial<ReplanTask> & { id: string }): ReplanTask => ({
  label: over.id,
  status: 'NOT_STARTED',
  dependsOn: [],
  released: false,
  resource: 'impressao|roland',
  hours,
  intervalMinutes: 0,
  afterDoneMinutes: 0,
  minutes: 60,
  remainingMinutes: 60,
  schedule: { date: DAY, start: '09:00' },
  completedAt: null,
  ...over,
});

const at = (time: string, date = DAY) => momentOf(date, time);

describe('agenda viva da cadeia (replan)', () => {
  it('a criação atrasou: a impressão dela vai para depois e outra ocupa o lugar', () => {
    const moves = replan({
      calendar,
      now: at('09:00'),
      tasks: [
        task({
          id: 'criacao',
          label: 'Criação',
          resource: 'criacao|',
          status: 'IN_PROGRESS',
          remainingMinutes: 120,
          schedule: { date: DAY, start: '08:00' },
        }),
        task({
          id: 'imp-a',
          dependsOn: ['criacao'],
          schedule: { date: DAY, start: '10:00' },
        }),
        task({ id: 'imp-b', schedule: { date: DAY, start: '11:00' } }),
      ],
    });
    const a = moves.find((move) => move.id === 'imp-a');
    const b = moves.find((move) => move.id === 'imp-b');
    expect(b).toMatchObject({
      to: { date: DAY, start: '09:00' },
      reason: 'EARLIER',
    });
    expect(a).toMatchObject({
      to: { date: DAY, start: '11:00' },
      reason: 'LATE_PREDECESSOR',
      by: 'Criação',
    });
  });

  it('a etapa anterior terminou antes: a seguinte é puxada para mais cedo', () => {
    const moves = replan({
      calendar,
      now: at('09:30'),
      tasks: [
        task({
          id: 'criacao',
          resource: 'criacao|',
          status: 'DONE',
          completedAt: at('09:30'),
        }),
        task({
          id: 'imp',
          dependsOn: ['criacao'],
          schedule: { date: DAY, start: '14:00' },
        }),
      ],
    });
    expect(moves).toEqual([
      expect.objectContaining({ id: 'imp', to: { date: DAY, start: '09:30' } }),
    ]);
  });

  it('a criação aprovada na terça adianta a impressão de quinta, se houver espaço', () => {
    const tuesday = '2026-11-24';
    const thursday = '2026-11-26';
    const moves = replan({
      calendar,
      now: momentOf(tuesday, '10:00'),
      tasks: [
        task({
          id: 'criacao',
          resource: 'criacao|',
          status: 'DONE',
          completedAt: momentOf(tuesday, '09:40'),
        }),
        task({
          id: 'imp',
          dependsOn: ['criacao'],
          schedule: { date: thursday, start: '09:00' },
        }),
      ],
    });
    expect(moves).toEqual([
      expect.objectContaining({
        id: 'imp',
        to: { date: tuesday, start: '10:00' },
      }),
    ]);
  });

  it('travada (o cadeado): não adianta nem atrasa', () => {
    const base = [
      task({ id: 'imp', status: 'IN_PROGRESS', remainingMinutes: 360 }),
      task({
        id: 'instalacao',
        resource: 'instalacao|',
        dependsOn: ['imp'],
        locked: true,
        schedule: { date: NEXT, start: '14:00' },
      }),
    ];
    expect(replan({ calendar, now: at('09:00'), tasks: base })).toEqual([]);
    expect(
      replan({
        calendar,
        now: at('09:00'),
        tasks: [{ ...base[0], remainingMinutes: 60 * 20 }, base[1]],
      }),
    ).toEqual([]);
  });

  it('destravada, a instalação de quinta adianta para quarta ou atrasa', () => {
    const install = task({
      id: 'instalacao',
      resource: 'instalacao|',
      dependsOn: ['imp'],
      schedule: { date: NEXT, start: '14:00' },
    });
    const early = replan({
      calendar,
      now: at('09:00'),
      tasks: [
        task({ id: 'imp', status: 'IN_PROGRESS', remainingMinutes: 60 }),
        install,
      ],
    });
    expect(early).toEqual([
      expect.objectContaining({
        id: 'instalacao',
        to: { date: DAY, start: '10:00' },
      }),
    ]);
    // A impressão termina na sexta: a instalação vai para depois e avisa
    const late = replan({
      calendar,
      now: at('09:00'),
      tasks: [
        task({ id: 'imp', status: 'IN_PROGRESS', remainingMinutes: 60 * 19 }),
        install,
      ],
    });
    expect(late).toEqual([
      expect.objectContaining({
        id: 'instalacao',
        to: { date: '2026-11-27', start: '10:00' },
        reason: 'LATE_PREDECESSOR',
      }),
    ]);
  });

  it('a equipe sem máquina faz uma por vez', () => {
    const moves = replan({
      calendar,
      now: at('08:00'),
      tasks: [
        task({
          id: 'a',
          resource: 'instalacao|',
          minutes: 120,
          schedule: { date: DAY, start: '08:00' },
        }),
        task({
          id: 'b',
          resource: 'instalacao|',
          minutes: 60,
          schedule: { date: DAY, start: '08:00' },
        }),
      ],
    });
    expect(moves).toEqual([
      expect.objectContaining({ id: 'b', to: { date: DAY, start: '10:00' } }),
    ]);
  });

  it('o que não cabe hoje vai ao dia útil seguinte', () => {
    const moves = replan({
      calendar,
      now: at('17:30'),
      tasks: [
        task({ id: 'a', status: 'IN_PROGRESS', remainingMinutes: 60 }),
        task({ id: 'b', schedule: { date: DAY, start: '17:00' } }),
      ],
    });
    // a termina às 09:30 de amanhã (meia hora hoje, uma hora amanhã)
    expect(moves).toEqual([
      expect.objectContaining({ id: 'b', to: { date: NEXT, start: '08:30' } }),
    ]);
  });

  it('a anterior que liberou a próxima etapa não segura a cadeia', () => {
    const moves = replan({
      calendar,
      now: at('09:00'),
      tasks: [
        task({
          id: 'criacao',
          resource: 'criacao|',
          status: 'IN_PROGRESS',
          remainingMinutes: 300,
          released: true,
        }),
        task({ id: 'imp', dependsOn: ['criacao'] }),
      ],
    });
    expect(moves).toEqual([]);
  });

  it('só o dia anda só quando o dia muda', () => {
    const moves = replan({
      calendar,
      now: at('09:00'),
      tasks: [task({ id: 'a', schedule: { date: DAY, start: null } })],
    });
    expect(moves).toEqual([]);
  });

  it('a espera após a conclusão (secagem) entra antes da seguinte', () => {
    const moves = replan({
      calendar,
      now: at('09:00'),
      tasks: [
        task({
          id: 'imp',
          status: 'DONE',
          completedAt: at('09:00'),
          afterDoneMinutes: 90,
        }),
        task({
          id: 'acab',
          resource: 'acabamento|',
          dependsOn: ['imp'],
          schedule: { date: DAY, start: '09:00' },
        }),
      ],
    });
    expect(moves).toEqual([
      expect.objectContaining({
        id: 'acab',
        to: { date: DAY, start: '10:30' },
      }),
    ]);
  });

  it('o relógio de trabalho pula o almoço e o fim de semana', () => {
    const clock = new WorkClock(calendar);
    // sexta 17:00 + 2h: 1h na sexta, 1h na segunda
    const friday = '2026-11-27';
    expect(clock.finish(momentOf(friday, '17:00'), 120, hours)).toBe(
      momentOf('2026-11-30', '09:00'),
    );
    expect(clock.startAt(momentOf(DAY, '12:10'), hours)).toBe(at('13:00'));
  });
});
