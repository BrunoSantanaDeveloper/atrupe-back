import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProductionViewer } from './production-access.service';
import { ProductionTaskService } from './production-task.service';

/**
 * O envio direto dos anexos da tarefa (GP-48 item 27): a chave volta do
 * navegador, então só vale a do formato que o link gerou, uma vez só, e o
 * arquivo de chave registrada nunca é apagado como recusado.
 */

const KEY =
  'production/c1/t1/0f8fad5b-d9cb-469f-a165-70867728950e-arte-final.pdf';
const DIRECT = { key: KEY, fileName: 'arte final.pdf' };

const VIEWER = {
  companyId: 'c1',
  userId: 'u1',
  employeeId: 'e1',
  name: 'Ana',
  manager: false,
} as ProductionViewer;

const setup = () => {
  const prisma = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
    productionAttachmentVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    orderFile: { findFirst: jest.fn().mockResolvedValue(null) },
    productionAttachment: {
      create: jest.fn().mockResolvedValue({ id: 'a1' }),
      delete: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue({
        id: 'a1',
        name: 'Arte',
        versions: [
          { version: 1, storageKey: KEY, current: true, uploadedById: 'u1' },
        ],
      }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'a1',
        name: 'Arte',
        kind: 'OTHER',
        versions: [],
      }),
    },
    productionTaskHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const storage = {
    configured: () => true,
    signedUrl: () => null,
    uploadUrl: jest.fn().mockReturnValue('https://put'),
    sizeOf: jest.fn().mockResolvedValue(1000),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const files = {
    summary: jest.fn().mockResolvedValue({
      usedBytes: 0,
      quotaBytes: null,
      maxFileBytes: 5000,
    }),
    assertFits: jest.fn(),
  };
  const service = new ProductionTaskService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    storage as never,
    files as never,
  );
  // A tarefa visível ao usuário (o load tem o próprio teste de acesso)
  Object.assign(service, { load: jest.fn().mockResolvedValue({}) });
  return { service, prisma, storage, files };
};

describe('ProductionTaskService: anexo enviado direto', () => {
  it('o link assina o tamanho declarado e o tipo pelo nome', async () => {
    const { service, storage } = setup();
    const link = await service.uploadLink(VIEWER, 't1', {
      fileName: 'arte final.pdf',
      size: 1234,
    });
    expect(link.mime).toBe('application/pdf');
    expect(link.key).toMatch(
      /^production\/c1\/t1\/[0-9a-f-]{36}-arte-final\.pdf$/,
    );
    expect(storage.uploadUrl).toHaveBeenCalledWith(
      link.key,
      1234,
      'application/pdf',
    );
  });

  it('registra com o tamanho do armazenamento e o tipo do link', async () => {
    const { service, prisma } = setup();
    await service.addAttachmentDirect(VIEWER, 't1', {
      ...DIRECT,
      mime: 'text/html',
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    const created = prisma.productionAttachment.create.mock.calls[0][0];
    expect(created.data.versions.create).toMatchObject({
      storageKey: KEY,
      size: 1000,
      mime: 'application/pdf',
    });
  });

  it('recusa a chave fora do formato, de outra tarefa ou de outro nome', async () => {
    const { service, storage } = setup();
    for (const key of [
      KEY.replace('production/c1/t1/', 'production/c1/t2/'),
      KEY.replace('production/c1/t1/', 'production/c2/t1/'),
      KEY.replace('production/c1/t1/', 'production/c1/t1/../t2/'),
      KEY.replace('production/c1/t1/', 'production/c1/t1//'),
      'production/c1/t1/arte-final.pdf',
    ]) {
      await expect(
        service.addAttachmentDirect(VIEWER, 't1', { ...DIRECT, key }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      service.addVersionDirect(VIEWER, 't1', 'a1', {
        ...DIRECT,
        fileName: 'outra.pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.sizeOf).not.toHaveBeenCalled();
  });

  it('a chave do arquivo de outra pessoa (já registrada) é recusada', async () => {
    const { service, prisma, storage } = setup();
    prisma.productionAttachmentVersion.findFirst.mockResolvedValue({ id: 'v' });
    await expect(
      service.addAttachmentDirect(VIEWER, 't1', DIRECT),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.addVersionDirect(VIEWER, 't1', 'a1', DIRECT),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.sizeOf).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(prisma.productionAttachment.create).not.toHaveBeenCalled();
    expect(prisma.productionAttachmentVersion.create).not.toHaveBeenCalled();
  });

  it('o envio repetido não cria a segunda linha', async () => {
    const { service, prisma } = setup();
    // Livre na primeira conferência; registrada ao travar (o outro gravou)
    prisma.productionAttachmentVersion.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'v' });
    await expect(
      service.addVersionDirect(VIEWER, 't1', 'a1', DIRECT),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.productionAttachmentVersion.create).not.toHaveBeenCalled();
    expect(
      prisma.productionAttachmentVersion.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('arquivo grande demais: apaga o recusado só se a chave estiver livre', async () => {
    const first = setup();
    first.storage.sizeOf.mockResolvedValue(9000);
    await expect(
      first.service.addAttachmentDirect(VIEWER, 't1', DIRECT),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(first.storage.remove).toHaveBeenCalledWith(KEY);

    // Registrada entre a conferência e a recusa: o arquivo fica
    const second = setup();
    second.storage.sizeOf.mockResolvedValue(9000);
    second.prisma.orderFile.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'f' });
    await expect(
      second.service.addAttachmentDirect(VIEWER, 't1', DIRECT),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(second.storage.remove).not.toHaveBeenCalled();
  });

  it('o arquivo que não chegou (404 ou 403) é recusado', async () => {
    const { service, storage } = setup();
    storage.sizeOf.mockResolvedValue(null);
    await expect(
      service.addAttachmentDirect(VIEWER, 't1', DIRECT),
    ).rejects.toThrow('O arquivo não chegou ao armazenamento. Envie de novo.');
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('apagar o anexo não apaga o arquivo que outra linha ainda usa', async () => {
    const { service, prisma, storage } = setup();
    prisma.productionAttachmentVersion.findFirst.mockResolvedValue({ id: 'v' });
    await service.deleteAttachment(VIEWER, 't1', 'a1');
    expect(prisma.productionAttachment.delete).toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();

    const free = setup();
    await free.service.deleteAttachment(VIEWER, 't1', 'a1');
    expect(free.storage.remove).toHaveBeenCalledWith(KEY);
  });
});
