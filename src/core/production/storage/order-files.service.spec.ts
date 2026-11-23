import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OrderFilesService } from './order-files.service';

const setup = (opts: { sellerId?: string; others?: boolean } = {}) => {
  const prisma = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
    productionAttachmentVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    order: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'o1',
        quotation: { sellerId: opts.sellerId ?? 'e1' },
      }),
    },
    orderFile: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'f1',
          fileName: 'projeto.pdf',
          size: 1000,
          mime: 'application/pdf',
          storageKey: 'orders/c1/o1/x-projeto.pdf',
          uploadedBy: 'Ana',
          uploadedAt: new Date('2026-11-22T12:00:00Z'),
          removedAt: null,
        },
        {
          id: 'f2',
          fileName: 'velho.png',
          size: 500,
          mime: 'image/png',
          storageKey: 'orders/c1/o1/y-velho.png',
          uploadedBy: 'Ana',
          uploadedAt: new Date('2026-01-02T12:00:00Z'),
          removedAt: new Date('2026-11-20T03:40:00Z'),
        },
      ]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  // A transação roda no próprio mock: a trava e a conferência da chave
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const abac = {
    canAccessOtherSellers: jest.fn().mockResolvedValue(opts.others ?? false),
  };
  const files = {
    summary: jest.fn().mockResolvedValue({ usedBytes: 1500 }),
    assertFits: jest.fn(),
  };
  const storage = {
    configured: () => true,
    signedUrl: (key: string) => `https://s/${key}`,
    uploadUrl: jest.fn().mockReturnValue('https://put'),
    sizeOf: jest.fn().mockResolvedValue(1000),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const service = new OrderFilesService(
    prisma as never,
    abac as never,
    files as never,
    storage as never,
  );
  return { service, prisma, files, storage };
};

const USER = { companyId: 'c1', employeeId: 'e1', name: 'Ana', userId: 'u1' };
const KEY = 'orders/c1/o1/0f8fad5b-d9cb-469f-a165-70867728950e-arte-final.pdf';
const DIRECT = { key: KEY, fileName: 'arte final.pdf' };

describe('OrderFilesService (arquivos da O.S., GP-49)', () => {
  it('lista com o link; o apagado na limpeza vem sem link', async () => {
    const { service } = setup();
    const result = await service.list(
      { companyId: 'c1', employeeId: 'e1' },
      'o1',
    );
    expect(result.files.map((file) => file.url)).toEqual([
      'https://s/orders/c1/o1/x-projeto.pdf',
      null,
    ]);
    expect(result.files[1].removedAt).toBe('2026-11-20T03:40:00.000Z');
  });

  it('o vendedor sem acesso aos outros não vê a O.S. de outro', async () => {
    const { service } = setup({ sellerId: 'e2' });
    await expect(
      service.list({ companyId: 'c1', employeeId: 'e1' }, 'o1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('quem vê os outros vendedores, e o administrador, veem', async () => {
    await expect(
      setup({ sellerId: 'e2', others: true }).service.list(
        { companyId: 'c1', employeeId: 'e1' },
        'o1',
      ),
    ).resolves.toBeTruthy();
    await expect(
      setup({ sellerId: 'e2' }).service.list(
        { companyId: 'c1', employeeId: 'e1', isAdmin: true },
        'o1',
      ),
    ).resolves.toBeTruthy();
  });

  it('a O.S. de outra empresa não existe', async () => {
    const { service, prisma } = setup();
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(
      service.list({ companyId: 'c2' }, 'o1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrderFilesService: envio direto ao armazenamento', () => {
  it('o link assina o tamanho declarado e o tipo pelo nome', async () => {
    const { service, storage } = setup();
    const link = await service.uploadLink(USER, 'o1', {
      fileName: 'arte final.pdf',
      size: 1234,
    });
    expect(link.mime).toBe('application/pdf');
    expect(link.key).toMatch(/^orders\/c1\/o1\/[0-9a-f-]{36}-arte-final\.pdf$/);
    expect(storage.uploadUrl).toHaveBeenCalledWith(
      link.key,
      1234,
      'application/pdf',
    );
  });

  it('registra com o tamanho do armazenamento e o tipo do link', async () => {
    const { service, prisma } = setup();
    await service.addDirect(USER, 'o1', { ...DIRECT, mime: 'text/html' });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.orderFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storageKey: KEY,
        size: 1000,
        mime: 'application/pdf',
        fileName: 'arte final.pdf',
      }),
    });
  });

  it('recusa a chave fora do formato, de outra O.S. ou de outro nome', async () => {
    const { service, storage } = setup();
    for (const key of [
      KEY.replace('orders/c1/o1/', 'orders/c1/o2/'),
      KEY.replace('orders/c1/o1/', 'orders/c1/o1/../o2/'),
      KEY.replace('orders/c1/o1/', 'orders/c1/o1//'),
      'orders/c1/o1/arte-final.pdf',
    ]) {
      await expect(
        service.addDirect(USER, 'o1', { ...DIRECT, key }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      service.addDirect(USER, 'o1', { ...DIRECT, fileName: 'outra.pdf' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.sizeOf).not.toHaveBeenCalled();
  });

  it('a chave já registrada é recusada e o arquivo dela fica', async () => {
    const { service, prisma, storage } = setup();
    prisma.productionAttachmentVersion.findFirst.mockResolvedValue({ id: 'v' });
    await expect(service.addDirect(USER, 'o1', DIRECT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    prisma.productionAttachmentVersion.findFirst.mockResolvedValue(null);
    prisma.orderFile.findFirst.mockResolvedValue({ id: 'f1' });
    await expect(service.addDirect(USER, 'o1', DIRECT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(storage.sizeOf).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(prisma.orderFile.create).not.toHaveBeenCalled();
  });

  it('o envio repetido não cria a segunda linha', async () => {
    const { service, prisma } = setup();
    // Livre na primeira conferência; registrada ao travar (o outro gravou)
    prisma.orderFile.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'f1' });
    await expect(service.addDirect(USER, 'o1', DIRECT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.orderFile.create).not.toHaveBeenCalled();
  });

  it('sem espaço, apaga o arquivo recusado só se a chave estiver livre', async () => {
    const full = { usedBytes: 0, quotaBytes: 10, maxFileBytes: 5000 };
    const first = setup();
    first.files.summary.mockResolvedValue(full);
    await expect(
      first.service.addDirect(USER, 'o1', DIRECT),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(first.storage.remove).toHaveBeenCalledWith(KEY);

    // Registrada entre a conferência e a recusa: o arquivo fica
    const second = setup();
    second.files.summary.mockResolvedValue(full);
    second.prisma.orderFile.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'f1' });
    await expect(
      second.service.addDirect(USER, 'o1', DIRECT),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(second.storage.remove).not.toHaveBeenCalled();
  });

  it('o arquivo que não chegou é recusado sem apagar nada', async () => {
    const { service, storage } = setup();
    storage.sizeOf.mockResolvedValue(null);
    await expect(service.addDirect(USER, 'o1', DIRECT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('apagar a linha não apaga o arquivo que outra linha ainda usa', async () => {
    const { service, prisma, storage } = setup();
    prisma.orderFile.findFirst
      .mockResolvedValueOnce({ id: 'f1', storageKey: KEY, removedAt: null })
      .mockResolvedValueOnce({ id: 'f9' });
    await service.remove(USER, 'o1', 'f1');
    expect(prisma.orderFile.delete).toHaveBeenCalledWith({
      where: { id: 'f1' },
    });
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
