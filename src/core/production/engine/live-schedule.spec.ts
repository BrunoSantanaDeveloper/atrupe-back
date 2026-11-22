import { rescheduleAfter } from './live-schedule';

const noBreak = { breakStart: null, breakEnd: null, runsThroughBreak: false };
const lunch = {
  breakStart: '12:00',
  breakEnd: '13:00',
  runsThroughBreak: false,
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
      { id: 'b', from: '10:00', to: '10:45' },
      { id: 'c', from: '10:35', to: '11:20' },
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
    expect(moves).toEqual([{ id: 'b', from: '10:00', to: '10:20' }]);
  });

  it('quem cairia no almoço começa depois dele', () => {
    const moves = rescheduleAfter({
      freeAt: 12 * 60 + 10,
      intervalMinutes: 0,
      hours: lunch,
      tasks: [{ id: 'b', start: '11:50', minutes: 30 }],
    });
    expect(moves).toEqual([{ id: 'b', from: '11:50', to: '13:00' }]);
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
      { id: 'b', from: '11:00', to: '11:30' },
      { id: 'c', from: '12:30', to: '14:00' },
    ]);
    expect(
      rescheduleAfter({
        freeAt: 11 * 60 + 30,
        intervalMinutes: 0,
        hours: { ...lunch, runsThroughBreak: true },
        tasks,
      }),
    ).toEqual([
      { id: 'b', from: '11:00', to: '11:30' },
      { id: 'c', from: '12:30', to: '13:00' },
    ]);
  });
});
