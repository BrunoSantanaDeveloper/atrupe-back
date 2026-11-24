import { carrySlots } from './slot-carry';

const today = '2026-11-24'; // terça
const base = { today, firstWorkDay: today };

describe('o que não foi feito no bloco passa para o seguinte', () => {
  it('nada feito na segunda: as 2h vão para o bloco de terça', () => {
    const ops = carrySlots({
      ...base,
      blocks: [
        {
          id: 'main',
          date: '2026-11-23',
          start: '08:00',
          minutes: 120,
          worked: 0,
        },
        { id: 's1', date: today, start: '08:00', minutes: 180, worked: 0 },
      ],
    });
    expect(ops).toEqual([
      { kind: 'move', id: 'main', date: today, start: '08:00', minutes: 300 },
      { kind: 'delete', id: 's1' },
    ]);
  });

  it('feito em parte: o bloco fica com o feito e o resto vai para o seguinte', () => {
    const ops = carrySlots({
      ...base,
      blocks: [
        {
          id: 'main',
          date: '2026-11-23',
          start: '08:00',
          minutes: 120,
          worked: 50,
        },
        { id: 's1', date: today, start: '08:00', minutes: 180, worked: 0 },
      ],
    });
    expect(ops).toEqual([
      { kind: 'minutes', id: 'main', minutes: 50 },
      { kind: 'minutes', id: 's1', minutes: 250 },
    ]);
  });

  it('sem bloco seguinte: o resto nasce no primeiro dia útil', () => {
    const ops = carrySlots({
      ...base,
      blocks: [
        {
          id: 'main',
          date: '2026-11-20',
          start: null,
          minutes: 60,
          worked: 60,
        },
        { id: 's1', date: '2026-11-23', start: null, minutes: 120, worked: 30 },
      ],
    });
    expect(ops).toEqual([
      { kind: 'minutes', id: 's1', minutes: 30 },
      { kind: 'create', date: today, minutes: 90 },
    ]);
  });

  it('o bloco de hoje e os futuros não mexem', () => {
    expect(
      carrySlots({
        ...base,
        blocks: [
          { id: 'main', date: today, start: null, minutes: 60, worked: 0 },
          { id: 's1', date: '2026-11-25', start: null, minutes: 60, worked: 0 },
        ],
      }),
    ).toEqual([]);
  });
});
