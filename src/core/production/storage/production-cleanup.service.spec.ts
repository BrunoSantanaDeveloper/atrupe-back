import { BadRequestException } from '@nestjs/common';
import { ProductionCleanupService } from './production-cleanup.service';

const MB = 1024 * 1024;
const at = (day: string) => new Date(`${day}T12:00:00Z`);

const version = (id: string, day: string, mb: number, taskId = 't1') => ({
  id,
  size: mb * MB,
  uploadedAt: at(day),
  storageKey: `key-${id}`,
  attachment: { taskId, task: { project: { quotationId: 'q1' } } },
});
const orderFile = (id: string, day: string, mb: number) => ({
  id,
  size: mb * MB,
  uploadedAt: at(day),
  storageKey: `key-${id}`,
  order: { quotationId: 'q2' },
});

describe('ProductionCleanupService (limpeza do espaço, GP-49)', () => {
  const tx = {
    $executeRaw: jest.fn(),
    productionAttachmentVersion: { findMany: jest.fn(), updateMany: jest.fn() },
    orderFile: { findMany: jest.fn(), updateMany: jest.fn() },
    productionTaskHistory: { createMany: jest.fn() },
    productionStorageCleanup: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
    productionAttachmentVersion: { findMany: jest.fn() },
    orderFile: { findMany: jest.fn() },
    productionStorageAuto: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const files = { summary: jest.fn() };
  const storage = { remove: jest.fn() };
  const plans = { getCompanyPlanInfo: jest.fn() };
  const service = new ProductionCleanupService(
    prisma as never,
    files as never,
    storage as never,
    plans as never,
  );
  const who = { companyId: 'c1', userId: 'u1', name: 'Ana' };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((cb) => cb(tx));
    files.summary.mockResolvedValue({
      usedBytes: 100 * MB,
      quotaBytes: 1024 * MB,
    });
    storage.remove.mockResolvedValue(undefined);
    tx.productionAttachmentVersion.findMany.mockResolvedValue([
      version('v1', '2026-01-01', 30),
      version('v2', '2026-02-01', 10, 't2'),
    ]);
    tx.orderFile.findMany.mockResolvedValue([
      orderFile('o1', '2026-01-15', 20),
    ]);
    tx.productionAttachmentVersion.updateMany.mockResolvedValue({ count: 2 });
    tx.orderFile.updateMany.mockResolvedValue({ count: 1 });
  });

  it('só entram os arquivos das O.S. entregues (finalizadas)', async () => {
    prisma.productionAttachmentVersion.findMany.mockResolvedValue([]);
    prisma.orderFile.findMany.mockResolvedValue([]);

    await service.preview('c1', 50);

    expect(prisma.productionAttachmentVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          removedAt: null,
          attachment: {
            task: {
              companyId: 'c1',
              project: { quotation: { order: { status: 'FINISHED' } } },
            },
          },
        },
      }),
    );
    expect(prisma.orderFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'c1',
          removedAt: null,
          order: { status: 'FINISHED' },
        },
      }),
    );
  });

  it('apaga sob a trava da empresa, com prazo próprio, e registra o que marcou', async () => {
    const result = await service.run(who, 60);

    expect(tx.$executeRaw.mock.calls[0][1]).toBe('storage-cleanup:c1');
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(tx.productionAttachmentVersion.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['v1', 'v2'] }, removedAt: null },
      data: { removedAt: expect.any(Date) },
    });
    expect(tx.orderFile.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['o1'] }, removedAt: null },
      data: { removedAt: expect.any(Date) },
    });
    // Uma linha por tarefa, de uma vez
    expect(tx.productionTaskHistory.createMany).toHaveBeenCalledTimes(1);
    expect(
      tx.productionTaskHistory.createMany.mock.calls[0][0].data.map((row) => [
        row.taskId,
        row.text.split(' na ')[0],
      ]),
    ).toEqual([
      ['t1', '1 arquivo removido'],
      ['t2', '1 arquivo removido'],
    ]);
    expect(tx.productionStorageCleanup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ files: 3, bytes: 60 * MB }),
    });
    expect(storage.remove).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ files: 3, bytes: 60 * MB, projects: 2 });
  });

  it('o arquivo apagado no meio do caminho não entra na conta', async () => {
    // v2 sumiu entre a leitura e a marcação
    tx.productionAttachmentVersion.updateMany.mockResolvedValue({ count: 1 });
    tx.productionAttachmentVersion.findMany
      .mockResolvedValueOnce([
        version('v1', '2026-01-01', 30),
        version('v2', '2026-02-01', 10, 't2'),
      ])
      .mockResolvedValueOnce([{ id: 'v1' }]);
    tx.orderFile.findMany
      .mockResolvedValueOnce([orderFile('o1', '2026-01-15', 20)])
      .mockResolvedValueOnce([{ id: 'o1' }]);

    const result = await service.run(who, 60);

    expect(tx.productionStorageCleanup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ files: 2, bytes: 50 * MB }),
    });
    expect(
      tx.productionTaskHistory.createMany.mock.calls[0][0].data.map(
        (row) => row.taskId,
      ),
    ).toEqual(['t1']);
    expect(storage.remove).toHaveBeenCalledTimes(2);
    expect(storage.remove).not.toHaveBeenCalledWith('key-v2');
    expect(result.files).toBe(2);
  });

  it('sem O.S. entregue, não apaga nada', async () => {
    tx.productionAttachmentVersion.findMany.mockResolvedValue([]);
    tx.orderFile.findMany.mockResolvedValue([]);
    await expect(service.run(who, 50)).rejects.toThrow(
      'Não há arquivos de O.S. entregues para apagar.',
    );
    expect(tx.productionAttachmentVersion.updateMany).not.toHaveBeenCalled();
  });

  describe('ligar a automática', () => {
    const auto = { enabled: true, percent: 50, threshold: 90 };

    it('estando desligada, pede o APAGAR digitado', async () => {
      prisma.productionStorageAuto.findUnique.mockResolvedValue(null);
      await expect(service.saveAuto('c1', auto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.saveAuto('c1', { ...auto, confirm: 'apagar ' }),
      ).resolves.toEqual(auto);
      expect(prisma.productionStorageAuto.upsert).toHaveBeenCalledTimes(1);
    });

    it('já ligada, ajustar o limite não pede de novo; desligar também não', async () => {
      prisma.productionStorageAuto.findUnique.mockResolvedValue({
        enabled: true,
      });
      await service.saveAuto('c1', { ...auto, threshold: 95 });
      await service.saveAuto('c1', { ...auto, enabled: false });
      expect(prisma.productionStorageAuto.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('a automática, de madrugada', () => {
    beforeEach(() => {
      prisma.productionStorageAuto.findMany.mockResolvedValue([
        { companyId: 'c1', enabled: true, percent: 50, threshold: 90 },
      ]);
      files.summary.mockResolvedValue({
        usedBytes: 1000 * MB,
        quotaBytes: 1024 * MB,
      });
    });

    it('pula a empresa sem assinatura ativa: a cota caiu pela cobrança', async () => {
      plans.getCompanyPlanInfo.mockResolvedValue(null);
      await service.runAutomatic();
      expect(files.summary).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('pula o teste grátis vencido', async () => {
      plans.getCompanyPlanInfo.mockResolvedValue({
        planType: 'TRIAL',
        isTrialActive: false,
      });
      await service.runAutomatic();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('com a assinatura ativa e acima do limite, limpa', async () => {
      plans.getCompanyPlanInfo.mockResolvedValue({
        planType: 'PRO',
        isTrialActive: false,
      });
      await service.runAutomatic();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.productionStorageCleanup.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          automatic: true,
          byName: 'Limpeza automática',
        }),
      });
    });
  });
});
