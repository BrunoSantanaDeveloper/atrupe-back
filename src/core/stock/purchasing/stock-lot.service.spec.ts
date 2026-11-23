import { BadRequestException, ConflictException } from '@nestjs/common';
import { consumeSale } from '../stock-consumption';
import { StockLotService } from './stock-lot.service';

/**
 * O estoque em memória, com o que a baixa da venda (consumeSale) e a baixa
 * no lote usam: o saldo, os movimentos, os lotes e o histórico do lote.
 */
type Row = Record<string, any>;

const matches = (row: Row, where: Row = {}) =>
  Object.entries(where).every(([key, value]) => {
    const current = row[key] ?? null;
    if (value === null) return current === null;
    if (typeof value === 'object' && 'not' in value) {
      return value.not === null ? current !== null : current !== value.not;
    }
    if (typeof value === 'object' && 'in' in value) {
      return value.in.includes(current);
    }
    return current === value;
  });

const apply = (row: Row, data: Row) => {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      row[key] = (row[key] ?? 0) + value.increment;
    } else if (value && typeof value === 'object' && 'decrement' in value) {
      row[key] = (row[key] ?? 0) - value.decrement;
    } else {
      row[key] = value;
    }
  }
  return row;
};

const MATERIAL = { name: 'Adesivo', unit: 'M2', sectorId: null };

function memory() {
  const items: Row[] = [
    {
      id: 's1',
      companyId: 'c1',
      key: 'adesivo|',
      materialId: 'adesivo',
      variationId: null,
      quantity: 100,
      averageCost: 1000,
    },
  ];
  const movements: Row[] = [];
  const lots: Row[] = [];
  const events: Row[] = [];
  const withStock = (lot: Row) => ({
    ...lot,
    stockItem: {
      materialId: 'adesivo',
      variationId: null,
      material: MATERIAL,
      variation: null,
    },
    events: [],
  });
  const db: any = {
    $executeRaw: jest.fn(async () => 0),
    quotation: {
      findUnique: jest.fn(async () => ({
        companyId: 'c1',
        quotationNumber: 12,
        description: 'Fachada',
        series: null,
        quotationProduct: [
          {
            origin: 'CATALOG',
            quantity: 1,
            materialId: null,
            materialVariationId: null,
            // A venda previu 3 m² de adesivo
            snapshot: {
              data: {
                stages: [
                  { lines: [{ resourceId: 'material:adesivo', quantity: 3 }] },
                ],
              },
            },
            lines: [],
          },
        ],
      })),
    },
    material: {
      findMany: jest.fn(async () => [{ id: 'adesivo' }]),
    },
    stockItem: {
      count: jest.fn(
        async ({ where }) => items.filter((row) => matches(row, where)).length,
      ),
      findUnique: jest.fn(
        async ({ where }) =>
          items.find(
            (row) =>
              row.companyId === where.companyId_key.companyId &&
              row.key === where.companyId_key.key,
          ) ?? null,
      ),
      upsert: jest.fn(async ({ where, create, update }) => {
        const found = items.find(
          (row) =>
            row.companyId === where.companyId_key.companyId &&
            row.key === where.companyId_key.key,
        );
        if (found) return apply(found, update);
        const row = { id: `s${items.length + 1}`, averageCost: 0, ...create };
        items.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }) =>
        apply(items.find((row) => row.id === where.id)!, data),
      ),
    },
    stockMovement: {
      count: jest.fn(
        async ({ where }) =>
          movements.filter((row) => matches(row, where)).length,
      ),
      findMany: jest.fn(async ({ where }) =>
        movements.filter((row) => matches(row, where)),
      ),
      create: jest.fn(async ({ data }) => {
        movements.push({ id: `mv${movements.length + 1}`, ...data });
      }),
    },
    stockLot: {
      findFirst: jest.fn(async ({ where, include }) => {
        const lot = lots.find(
          (row) => row.id === where.id && row.companyId === where.companyId,
        );
        if (!lot) return null;
        return include ? withStock(lot) : { ...lot };
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const hit = lots.filter((row) => matches(row, where));
        hit.forEach((row) => apply(row, data));
        return { count: hit.length };
      }),
      aggregate: jest.fn(async () => ({
        _max: { number: Math.max(0, ...lots.map((row) => row.number)) },
      })),
      create: jest.fn(async ({ data }) => {
        const { events: created, ...rest } = data;
        const row = {
          id: `L${lots.length + 1}`,
          createdAt: new Date(),
          finishedAt: null,
          cancelReason: null,
          ...rest,
        };
        lots.push(row);
        if (created?.create) events.push({ lotId: row.id, ...created.create });
        return row;
      }),
    },
    stockLotEvent: {
      create: jest.fn(async ({ data }) => {
        events.push(data);
      }),
    },
  };
  db.$transaction = jest.fn(async (fn) => fn(db));
  const addLot = (data: Row) => {
    const row = {
      id: `L${lots.length + 1}`,
      companyId: 'c1',
      stockItemId: 's1',
      number: lots.length + 1,
      supplierName: 'Lonas SA',
      brand: '',
      color: '',
      status: 'OPEN',
      sectorId: 'impressao',
      sectorName: 'Impressão',
      openedAt: new Date(),
      finishedAt: null,
      cancelReason: null,
      orderId: null,
      invoiceId: null,
      parentId: null,
      createdByName: 'Ana',
      createdAt: new Date(),
      ...data,
    };
    lots.push(row);
    return row;
  };
  const service = new StockLotService(db as never, {} as never);
  const balance = () => items.find((row) => row.id === 's1')!.quantity;
  return { db, service, lots, events, movements, addLot, balance };
}

// O rolo de 1 × 50 m (50 m²) aberto na impressão
const ROLL = {
  measure: 'ROLL',
  quantity: 50,
  width: 1,
  length: 50,
  currentQuantity: 50,
  currentWidth: 1,
  currentLength: 50,
  cost: 50000,
};

const task = {
  id: 't1',
  code: 'T-1',
  sectorId: 'impressao',
  stageName: 'Impressão',
  quotationId: 'q1',
  number: '12',
  consumption: [
    {
      kind: 'MATERIAL',
      resource: 'Adesivo',
      resourceId: 'material:adesivo',
      quantity: 3,
      unit: 'm²',
    },
  ],
};

const actor = { id: 'u1', name: 'Ana' };

describe('StockLotService (baixa no lote)', () => {
  describe('a baixa do rolo e a baixa da venda (ES-16)', () => {
    it('rolo antes da conclusão: a venda não tira de novo o adesivo', async () => {
      const { db, service, addLot, balance, movements } = memory();
      addLot(ROLL);
      // O impressor tira 4 m do rolo de 1 m de largura: 4 m²
      await service.useForTask('c1', task, { lotId: 'L1', length: 4 }, actor);
      await consumeSale(db, 'q1', 'Sistema');
      expect(balance()).toBe(96);
      expect(movements.filter((row) => row.kind === 'ADJUSTMENT')).toEqual([]);
    });

    it('rolo depois da conclusão: o que a venda tirou volta, uma vez', async () => {
      const { db, service, addLot, balance, movements } = memory();
      addLot(ROLL);
      await consumeSale(db, 'q1', 'Sistema');
      expect(balance()).toBe(97);
      const { text } = await service.useForTask(
        'c1',
        task,
        { lotId: 'L1', length: 4 },
        actor,
      );
      // O mesmo saldo da outra ordem: só o que saiu do rolo
      expect(balance()).toBe(96);
      expect(text).toContain('voltou ao saldo');
      const reversal = movements.filter((row) => row.kind === 'ADJUSTMENT');
      expect(reversal).toHaveLength(1);
      expect(reversal[0]).toMatchObject({
        quantity: 3,
        quotationId: 'q1',
        lotId: null,
        replacesKey: 'adesivo|',
        createdById: 'u1',
      });
      expect(reversal[0].origin).toContain('estorno da baixa da venda');

      // A baixa seguinte no rolo não estorna de novo
      await service.useForTask('c1', task, { lotId: 'L1', length: 1 }, actor);
      expect(balance()).toBe(95);
      expect(movements.filter((row) => row.kind === 'ADJUSTMENT')).toHaveLength(
        1,
      );
    });

    it('a baixa e a venda se enfileiram pela trava da venda', async () => {
      const { db, service, addLot } = memory();
      addLot(ROLL);
      await service.useForTask('c1', task, { lotId: 'L1', length: 1 }, actor);
      await consumeSale(db, 'q1', 'Sistema');
      const locks = db.$executeRaw.mock.calls.map((call: unknown[]) =>
        call.slice(1).join(''),
      );
      expect(locks).toEqual(['stock-sale:q1', 'stock-sale:q1']);
    });
  });

  it('o impressor não dá baixa no rolo de outro setor', async () => {
    const { service, addLot, balance } = memory();
    addLot({ ...ROLL, sectorId: 'acabamento', sectorName: 'Acabamento' });
    await expect(
      service.useForTask('c1', task, { lotId: 'L1', length: 4 }, actor),
    ).rejects.toThrow('outro setor (Acabamento)');
    expect(balance()).toBe(100);
  });

  it('a sobra medida 0 × 0 não zera o lote', async () => {
    const { service, addLot, lots } = memory();
    addLot(ROLL);
    await expect(
      service.use('c1', 'L1', { remainingWidth: 0, remainingLength: 0 }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(lots[0].currentQuantity).toBe(50);
    expect(lots[0].status).toBe('OPEN');
  });

  it('a baixa em lote que mudou no meio tempo é recusada', async () => {
    const { db, service, addLot, lots, balance } = memory();
    addLot(ROLL);
    const read = db.stockLot.findFirst.getMockImplementation();
    db.stockLot.findFirst
      .mockImplementationOnce(read)
      // A releitura na transação vê o lote antes de outra baixa gravar
      .mockImplementationOnce(async (args: any) => {
        const lot = await read(args);
        lots[0].currentQuantity = 45;
        return lot;
      });
    await expect(
      service.use('c1', 'L1', { length: 2 }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(balance()).toBe(100);
  });

  it('dividir por quantidade: a origem fica 1,5 × 40 e a baixa de 10 m tira 15 m²', async () => {
    const { service, addLot, lots } = memory();
    addLot({
      measure: 'ROLL',
      quantity: 75,
      width: 1.5,
      length: 50,
      currentQuantity: 75,
      currentWidth: 1.5,
      currentLength: 50,
      cost: 75000,
    });
    const { lot, piece } = await service.split(
      'c1',
      'L1',
      { quantity: 15 },
      actor,
    );
    expect(lot).toMatchObject({
      quantity: 60,
      width: 1.5,
      length: 40,
      currentQuantity: 60,
      currentWidth: 1.5,
      currentLength: 40,
      cost: 60000,
    });
    expect(piece).toMatchObject({
      quantity: 15,
      width: 1.5,
      length: 10,
      currentWidth: 1.5,
      currentLength: 10,
      cost: 15000,
      // O pedaço fica no setor do lote de origem
      sectorId: 'impressao',
      sectorName: 'Impressão',
    });
    await service.use('c1', 'L1', { length: 10 }, actor);
    expect(lots[0]).toMatchObject({
      currentQuantity: 45,
      currentWidth: 1.5,
      currentLength: 30,
    });
  });
});
