import { liveHoursOf, nextWorkDay, rescheduleAfter } from './live-schedule';

const noBreak = {
  workStart: '08:00',
  workEnd: '18:00',
  breakStart: null,
  breakEnd: null,
  runsThroughBreak: false,
};
const lunch = {
  ...noBreak,
  breakStart: '12:00',
  breakEnd: '13:00',
};

describe('rescheduleAfter (agenda viva gravada, GP-48 item 20)', () => {
  it('empurra os seguintes que já não cabem, na sequência, com o intervalo', () => {
    const moves = rescheduleAfter({
      freeAt: 10 * 60 + 40,
      intervalMinutes: 5,
      hours: noBreak,
      tasks: [
        { id: 'b', start: '10:00', minutes: 30 },
        { id: 'c', start: '10:35', minutes: 60 },
      ],
    });
    expect(moves).toEqual([
      { id: 'b', from: '10:00', to: '10:45', maintenance: null },
      { id: 'c', from: '10:35', to: '11:20', maintenance: null },
    ]);
  });

  it('não mexe no que ainda cabe nem puxa para mais cedo', () => {
    const moves = rescheduleAfter({
      freeAt: 9 * 60,
      intervalMinutes: 0,
      hours: noBreak,
      tasks: [
        { id: 'b', start: '10:00', minutes: 30 },
        { id: 'c', start: '14:00', minutes: 30 },
      ],
    });
    expect(moves).toEqual([]);
  });

  it('para no primeiro buraco que absorve o atraso', () => {
    const moves = rescheduleAfter({
      freeAt: 10 * 60 + 20,
      intervalMinutes: 0,
      hours: noBreak,
      tasks: [
        { id: 'b', start: '10:00', minutes: 30 },
        { id: 'c', start: '11:30', minutes: 30 },
      ],
    });
    expect(moves).toEqual([
      { id: 'b', from: '10:00', to: '10:20', maintenance: null },
    ]);
  });

  it('quem cairia no almoço começa depois dele', () => {
    const moves = rescheduleAfter({
      freeAt: 12 * 60 + 10,
      intervalMinutes: 0,
      hours: lunch,
      tasks: [{ id: 'b', start: '11:50', minutes: 30 }],
    });
    expect(moves).toEqual([
      { id: 'b', from: '11:50', to: '13:00', maintenance: null },
    ]);
  });

  it('a equipe que para no almoço termina mais tarde; a máquina que segue, não', () => {
    const tasks = [
      { id: 'b', start: '11:00', minutes: 90 },
      { id: 'c', start: '12:30', minutes: 30 },
    ];
    expect(
      rescheduleAfter({
        freeAt: 11 * 60 + 30,
        intervalMinutes: 0,
        hours: lunch,
        tasks,
      }),
    ).toEqual([
      { id: 'b', from: '11:00', to: '11:30', maintenance: null },
      { id: 'c', from: '12:30', to: '14:00', maintenance: null },
    ]);
    expect(
      rescheduleAfter({
        freeAt: 11 * 60 + 30,
        intervalMinutes: 0,
        hours: { ...lunch, runsThroughBreak: true },
        tasks,
      }),
    ).toEqual([
      { id: 'b', from: '11:00', to: '11:30', maintenance: null },
      { id: 'c', from: '12:30', to: '13:00', maintenance: null },
    ]);
  });

  describe('o fim do expediente', () => {
    it('o que não começa mais hoje vai ao próximo dia útil e não ocupa a máquina', () => {
      const moves = rescheduleAfter({
        freeAt: 17 * 60 + 40,
        intervalMinutes: 0,
        hours: noBreak,
        tasks: [
          { id: 'b', start: '17:00', minutes: 30 },
          { id: 'c', start: '17:30', minutes: 30 },
          { id: 'd', start: '19:00', minutes: 30 },
        ],
      });
      // b começa às 17:40 e passa do fim (a fila mostra o excedente); c já
      // começaria às 18:10; d foi posto à mão depois do expediente e cabe
      expect(moves).toEqual([
        { id: 'b', from: '17:00', to: '17:40', maintenance: null },
        { id: 'c', from: '17:30', to: null, maintenance: null },
      ]);
    });

    it('vale o fim do expediente do gerenciador', () => {
      expect(
        rescheduleAfter({
          freeAt: 15 * 60 + 50,
          intervalMinutes: 15,
          hours: { ...noBreak, workEnd: '16:00' },
          tasks: [{ id: 'b', start: '15:30', minutes: 20 }],
        }),
      ).toEqual([{ id: 'b', from: '15:30', to: null, maintenance: null }]);
    });
  });

  describe('a manutenção da máquina (GP-49 item 6)', () => {
    const blocks = [{ name: 'Troca da cabeça', from: 14 * 60, to: 16 * 60 }];

    it('quem cairia na manutenção começa depois dela', () => {
      expect(
        rescheduleAfter({
          freeAt: 13 * 60 + 50,
          intervalMinutes: 0,
          hours: noBreak,
          blocks,
          tasks: [
            { id: 'b', start: '13:30', minutes: 30 },
            { id: 'c', start: '16:00', minutes: 30 },
          ],
        }),
      ).toEqual([
        { id: 'b', from: '13:30', to: '16:00', maintenance: 'Troca da cabeça' },
        { id: 'c', from: '16:00', to: '16:30', maintenance: null },
      ]);
    });

    it('o agendado dentro da manutenção também anda; a manutenção até o fim do dia manda para o próximo dia útil', () => {
      expect(
        rescheduleAfter({
          freeAt: 9 * 60,
          intervalMinutes: 0,
          hours: noBreak,
          blocks: [{ name: 'Revisão', from: 15 * 60, to: 18 * 60 }],
          tasks: [
            { id: 'b', start: '10:00', minutes: 30 },
            { id: 'c', start: '15:30', minutes: 30 },
          ],
        }),
      ).toEqual([{ id: 'c', from: '15:30', to: null, maintenance: 'Revisão' }]);
    });

    it('a manutenção de outra hora não mexe em nada', () => {
      expect(
        rescheduleAfter({
          freeAt: 9 * 60,
          intervalMinutes: 0,
          hours: noBreak,
          blocks,
          tasks: [{ id: 'b', start: '10:00', minutes: 60 }],
        }),
      ).toEqual([]);
    });
  });
});

describe('liveHoursOf: o expediente efetivo', () => {
  const company = {
    startTime: '07:00',
    endTime: '17:00',
    breakStart: '11:30',
    breakEnd: '12:30',
  };
  const manager = {
    workStart: null,
    workEnd: null,
    breakStart: null,
    breakEnd: null,
    runsThroughBreak: false,
  };

  it('o do gerenciador, com o intervalo dele', () => {
    expect(
      liveHoursOf(
        { ...manager, workStart: '08:00', workEnd: '18:00' },
        company,
      ),
    ).toEqual({
      workStart: '08:00',
      workEnd: '18:00',
      breakStart: null,
      breakEnd: null,
      runsThroughBreak: false,
    });
  });

  it('sem ele, o da empresa, com o almoço da empresa', () => {
    expect(liveHoursOf(manager, company)).toEqual({
      workStart: '07:00',
      workEnd: '17:00',
      breakStart: '11:30',
      breakEnd: '12:30',
      runsThroughBreak: false,
    });
  });

  it('o intervalo do gerenciador vale mesmo sem o horário dele', () => {
    expect(
      liveHoursOf(
        {
          ...manager,
          breakStart: '12:00',
          breakEnd: '13:00',
          runsThroughBreak: true,
        },
        company,
      ),
    ).toMatchObject({
      workEnd: '17:00',
      breakStart: '12:00',
      breakEnd: '13:00',
      runsThroughBreak: true,
    });
  });
});

describe('nextWorkDay', () => {
  const calendar = { workDays: [1, 2, 3, 4, 5], holidays: ['2026-11-30'] };

  it('pula o fim de semana e o feriado', () => {
    // 27/11/2026 é sexta; 30/11 (segunda) é feriado
    expect(nextWorkDay('2026-11-27', calendar)).toBe('2026-12-01');
    expect(nextWorkDay('2026-11-24', calendar)).toBe('2026-11-25');
  });

  it('sem dia de trabalho no cadastro, o dia seguinte', () => {
    expect(nextWorkDay('2026-11-24', { workDays: [], holidays: [] })).toBe(
      '2026-11-25',
    );
  });
});
