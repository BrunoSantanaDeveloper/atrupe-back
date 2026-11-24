import { BadRequestException } from '@nestjs/common';
import { ProductionViewer } from './production-access.service';
import { ProductionTaskController } from './production-task.controller';
import { ProductionTaskService } from './production-task.service';

/**
 * A baixa conjunta (VS-2, FULL) pelo controller e a configuração produtiva
 * usada (item 10 do GP-48): o que é recusado antes de qualquer escrita.
 */
const VIEWER = {
  companyId: 'c1',
  userId: 'u1',
  employeeId: 'e1',
  name: 'Ana',
  manager: true,
} as ProductionViewer;

const T1 = '00000000-0000-4000-8000-000000000001';
const T2 = '00000000-0000-4000-8000-000000000002';
const LOT = '00000000-0000-4000-8000-0000000000a1';
const LOT2 = '00000000-0000-4000-8000-0000000000a2';

const controller = () => {
  const access = { viewer: jest.fn().mockResolvedValue(VIEWER) };
  const tasks = {
    lotTask: jest.fn(async (_viewer, id: string) => ({ id, code: id })),
    useSetup: jest.fn(),
    lotUsedIn: jest.fn(),
  };
  const lots = {
    useBatch: jest.fn().mockResolvedValue({ message: 'ok', waste: null }),
  };
  return {
    tasks,
    lots,
    controller: new ProductionTaskController(
      access as never,
      tasks as never,
      {} as never,
      lots as never,
    ),
  };
};

describe('a baixa conjunta pelo controller', () => {
  it('o segundo rolo sem os metros dele é recusado, sem gravar', async () => {
    const { controller: ctl, tasks, lots } = controller();
    await expect(
      ctl.lotUseBatch(
        { user: {} },
        {
          taskIds: [T1, T2],
          lotId: LOT,
          length: 10,
          secondLotId: LOT2,
        },
      ),
    ).rejects.toThrow(
      new BadRequestException('Informe os metros usados no segundo rolo'),
    );
    expect(tasks.lotTask).not.toHaveBeenCalled();
    expect(lots.useBatch).not.toHaveBeenCalled();
  });

  it('a troca de material de uma tarefa fora da impressão é recusada', async () => {
    const { controller: ctl, lots } = controller();
    await expect(
      ctl.lotUseBatch(
        { user: {} },
        {
          taskIds: [T1],
          lotId: LOT,
          length: 10,
          replaces: [{ taskId: T2, replaces: 'lona|' }],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(lots.useBatch).not.toHaveBeenCalled();
  });

  it('a troca por tarefa e o segundo rolo chegam à baixa', async () => {
    const { controller: ctl, lots } = controller();
    await ctl.lotUseBatch(
      { user: {} },
      {
        taskIds: [T1, T2, T1],
        lotId: LOT,
        length: 10,
        secondLotId: LOT2,
        secondLength: 2,
        replaces: [{ taskId: T2, replaces: null }],
      },
    );
    const [, input] = lots.useBatch.mock.calls[0];
    expect(input.tasks.map((task: { id: string }) => task.id)).toEqual([
      T1,
      T2,
    ]);
    expect(input.rolls).toEqual([
      { lotId: LOT, length: 10 },
      { lotId: LOT2, length: 2 },
    ]);
    expect([...input.replaces]).toEqual([[T2, null]]);
  });
});

describe('a configuração produtiva usada (useSetup)', () => {
  // A tarefa t1 é da Mimaki (configurações 4 e 8 passes); a t2, da Roland
  const setup = () => {
    const prisma: any = {
      productionTask: {
        findFirst: jest.fn(async ({ where }) =>
          where.id === 't1'
            ? { code: 'T-1', machine: 'Mimaki', machineSetupId: 'mimaki-4' }
            : { code: 'T-2', machine: 'Roland', machineSetupId: null },
        ),
        findUnique: jest.fn(async () => ({
          machineSetupId: 'mimaki-4',
          machineQuality: '4 passes',
        })),
        update: jest.fn(),
      },
      assetSetup: {
        findFirst: jest.fn(async ({ where }) =>
          where.id === 'mimaki-4' ? { assetId: 'mimaki' } : null,
        ),
        findMany: jest.fn(async ({ where }) =>
          where.assetId === 'mimaki'
            ? [
                { id: 'mimaki-4', name: '4 passes' },
                { id: 'mimaki-8', name: '8 passes' },
              ]
            : [{ id: 'roland-6', name: '6 passes' }],
        ),
      },
      asset: {
        findFirst: jest.fn(async ({ where }) =>
          where.name.equals === 'Roland' ? { id: 'roland' } : null,
        ),
      },
      productionTaskHistory: { create: jest.fn() },
    };
    const service = new ProductionTaskService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  };

  it('a configuração de outra máquina é recusada com 400', async () => {
    const { service, prisma } = setup();
    // 8 passes é da Mimaki: a tarefa da Roland não aceita
    await expect(
      service.useSetup(VIEWER, ['t1', 't2'], 'mimaki-8'),
    ).rejects.toThrow(
      new BadRequestException(
        'A configuração escolhida não é da máquina da tarefa T-2',
      ),
    );
    // Nem de outra empresa ou inexistente
    await expect(
      service.useSetup(VIEWER, ['t1'], 'outra'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.productionTask.update).not.toHaveBeenCalled();
  });

  it('a configuração da máquina grava na transação de quem chama', async () => {
    const { service, prisma } = setup();
    const save = await service.useSetup(VIEWER, ['t1'], 'mimaki-8');
    // Conferir não grava nada
    expect(prisma.productionTask.update).not.toHaveBeenCalled();
    await save(prisma);
    expect(prisma.productionTask.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { machineSetupId: 'mimaki-8', machineQuality: '8 passes' },
    });
    expect(prisma.productionTaskHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          text: 'Imprimiu em 8 passes (vendido em 4 passes)',
        }),
      }),
    );
  });
});
